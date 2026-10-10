import { Capacitor } from '@capacitor/core';
import { AdMob, AdmobConsentStatus, InterstitialAdPluginEvents, RewardAdPluginEvents } from '@capacitor-community/admob';

// ---------------------------------------------------------------------------
// AdMob configuration
//
// While TEST_MODE is true the game shows Google's sample ads (which earn nothing).
// To earn money:
//   1. Paste your ad unit IDs from https://admob.google.com below
//   2. Put your AdMob *App ID* in android/app/src/main/res/values/strings.xml (admob_app_id)
//   3. Set TEST_MODE to false and rebuild
// Never tap your own live ads - AdMob will suspend your account for invalid clicks.
// ---------------------------------------------------------------------------
const TEST_MODE = true;

const AD_UNITS = {
  interstitial: 'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX',
  rewarded: 'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX'
};

// Google's official sample ad units, safe to use while developing
const TEST_AD_UNITS = {
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917'
};

// Minimum time between interstitials so players aren't spammed
const INTERSTITIAL_COOLDOWN_MS = 3 * 60 * 1000;

const units = TEST_MODE ? TEST_AD_UNITS : AD_UNITS;

class AdManager {
  constructor() {
    this.enabled = Capacitor.isNativePlatform(); // Ads only exist in the Android app, not the web build
    this.ready = false;
    this.interstitialLoaded = false;
    this.rewardedLoaded = false;
    this.privacyOptionsRequired = false;
    // Start the cooldown at launch so the first death never shows an interstitial
    this.lastInterstitialAt = Date.now();
    this.pendingShow = null; // { resolve, earned } while an ad is on screen
  }

  async init() {
    if (!this.enabled) return;
    try {
      await AdMob.initialize({ tagForChildDirectedTreatment: false });

      // GDPR / US-state consent via Google's User Messaging Platform
      let consent = await AdMob.requestConsentInfo();
      if (consent.status === AdmobConsentStatus.REQUIRED && consent.isConsentFormAvailable) {
        consent = await AdMob.showConsentForm();
      }
      this.privacyOptionsRequired = consent.privacyOptionsRequirementStatus === 'REQUIRED';
      if (!consent.canRequestAds) return;

      this.registerListeners();
      this.ready = true;
      this.loadInterstitial();
      this.loadRewarded();
    } catch (e) {
      console.warn('AdMob init failed:', e);
    }
  }

  registerListeners() {
    AdMob.addListener(InterstitialAdPluginEvents.Loaded, () => (this.interstitialLoaded = true));
    AdMob.addListener(InterstitialAdPluginEvents.FailedToLoad, () => (this.interstitialLoaded = false));
    AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => this.finishShow(false, () => this.loadInterstitial()));
    AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, () => this.finishShow(false, () => this.loadInterstitial()));

    AdMob.addListener(RewardAdPluginEvents.Loaded, () => (this.rewardedLoaded = true));
    AdMob.addListener(RewardAdPluginEvents.FailedToLoad, () => (this.rewardedLoaded = false));
    AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
      if (this.pendingShow) this.pendingShow.earned = true;
    });
    AdMob.addListener(RewardAdPluginEvents.Dismissed, () => this.finishShow(null, () => this.loadRewarded()));
    AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => this.finishShow(false, () => this.loadRewarded()));
  }

  // Resolves the in-flight show() promise. earnedOverride null = use whether the reward fired.
  finishShow(earnedOverride, reload) {
    const pending = this.pendingShow;
    this.pendingShow = null;
    reload();
    if (pending) pending.resolve(earnedOverride ?? pending.earned);
  }

  loadInterstitial() {
    this.interstitialLoaded = false;
    AdMob.prepareInterstitial({ adId: units.interstitial, isTesting: TEST_MODE }).catch(() => {});
  }

  loadRewarded() {
    this.rewardedLoaded = false;
    AdMob.prepareRewardVideoAd({ adId: units.rewarded, isTesting: TEST_MODE }).catch(() => {});
  }

  get canShowRewarded() {
    return this.ready && this.rewardedLoaded && !this.pendingShow;
  }

  // Shows a rewarded ad. Resolves true only if the player watched it through and earned the reward.
  showRewarded() {
    if (!this.canShowRewarded) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.pendingShow = { resolve, earned: false };
      this.rewardedLoaded = false;
      AdMob.showRewardVideoAd().catch(() => this.finishShow(false, () => this.loadRewarded()));
    });
  }

  // Shows an interstitial if one is loaded and the cooldown has passed. Resolves when it closes.
  maybeShowInterstitial() {
    const due = Date.now() - this.lastInterstitialAt >= INTERSTITIAL_COOLDOWN_MS;
    if (!this.ready || !this.interstitialLoaded || this.pendingShow || !due) return Promise.resolve(false);
    this.lastInterstitialAt = Date.now();
    return new Promise((resolve) => {
      this.pendingShow = { resolve, earned: false };
      this.interstitialLoaded = false;
      AdMob.showInterstitial().catch(() => this.finishShow(false, () => this.loadInterstitial()));
    });
  }

  // Lets players in regions that require it (e.g. the EU) change their ad consent choices
  showPrivacyOptions() {
    if (this.enabled) AdMob.showPrivacyOptionsForm().catch(() => {});
  }
}

export const ads = new AdManager();
