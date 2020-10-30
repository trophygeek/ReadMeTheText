import {
  logerr,
  trace,
  PLAYBACKSTATE,
  asycChromeExt,
  generateUniqueId,
  sha1,
  splitvoicename,
  capitalize
} from './misc.js';
import {VOICESOUNDFORMAT, VOICEPROFILE, VOICEMODEL} from './voiceslist.js';

// static class (singleton)
// todo: break out quota data into it's own "class"

// <editor-fold defaultstate="collapsed" desc="-- DEFAULT_REQUEST_DATA  --">

export const DEFAULT_VOICE_NAME = 'en-US-Wavenet-A';
export const CHAR_COUNT_WAVE_FREE_MAX = 1000000;
export const CHAR_COUNT_STD_FREE_MAX = 4000000;
/**
 const audioConfig = {
  audioEncoding: "LINEAR16",  // MP3_64_KBPS, MP3_32_KBPS
  effectsProfileId: "telephony-class-application",
  pitch: 0.0,
  speakingRate: 1.0,
};

 const voice = {
  languageCode: "en-US",
  name: DEFAULT_VOICE_NAME,
};

 export const DEFAULT_REQUEST_DATA = {
  apiKey: '',   // todo: must be filled in.
  audioConfig,
  voice,
};
 **/
// </editor-fold>

// singleton. StateBus is set by the background and toolbar and option pages.
export const StateBus = {

  /**
   * @private
   */
  _data: {
    /** @var {string} */
    current_state: 'IDLE', // PLAYBACKSTATE.IDLE
    /** @var {string} */
    lasterr: '',
  },
  KEY: 'StateBusLocal',
  
  /**
   * @var {function}
   * @private
   */
  _change_callback_fn: null,


  // Played with the background page holding state and toolbar and options page using events to poll it,
  // but that's actually pretty slow. localstorage is faster.

  /**
   * @return {string}
   */
  get currentState() {
    return StateBus._data.current_state;
  },

  /**
   * @param newvalue {String} should be PLAYBACKSTATE
   */
  set currentState(newvalue) {
    console.assert(typeof newvalue === 'string');
    if (StateBus._data.current_state === newvalue) {
      return;
    }
    StateBus._data.current_state = newvalue;
    // We know we're NOT awaiting, fire and forget.
    asycChromeExt.setLocalStorageData(StateBus.KEY, StateBus._data);
  },
  
  get lastError() {
    return StateBus._data.lasterr;
  },
  set lastError(errstr) {
    // humm... save? Maybe better to combine with currentState for efficiency.
    StateBus._data.lasterr = errstr;
    if (errstr !== '') {
      StateBus.currentState = PLAYBACKSTATE.ERROR;
    }
  },
  clearLastError() {
    StateBus._data.lasterr = '';
    asycChromeExt.setLocalStorageData(StateBus.KEY, StateBus._data);
  },

  /**
   * This will ONLY get called when another instance changes the value.
   * @property
   * @param callbackonchange_fn {function}
   */
  set onchange(callbackonchange_fn) {
    StateBus._change_callback_fn = callbackonchange_fn;
  },

  /**
   * @param callbackonchange_fn {function}
   */
  async init(callbackonchange_fn) {
    StateBus._data = await asycChromeExt.getLocalStorageData(StateBus.KEY, StateBus._data);
    StateBus.onchange = callbackonchange_fn;

    chrome.storage.onChanged.addListener(function (changes, namespace) {
      trace('StateBus.onchange changes ', changes);
      // namespace == "local" || "remote"... interesting.
      let something_changed = false;
      for (let key in changes) {
        if (!changes.hasOwnProperty(key)) {
          continue;
        }  // keeps linter happy

        const storageChange = changes[key].newValue;
        switch (key) {
          case StateBus.KEY:
            if (StateBus._data.current_state !== storageChange.current_state ||
                StateBus._data.lasterr !== storageChange.lasterr) {
              StateBus._data = storageChange;
              something_changed = true;
            }
            break;
        }
      }
      if (something_changed && StateBus._change_callback_fn) {
        queueMicrotask(StateBus._change_callback_fn);
      }
    });
  }
};

// singleton
export const Settings = {
  // this data can be directly access (for simplicity). init() loads it all, save() saves it.
  // this storage type does NOT show up in the chrome debugger.
  // Use https://chrome.google.com/webstore/detail/storage-area-explorer/ocfjjjjhkpapocigimmppepjgfdecjkb to view
  // or chrome://sync-internals/

  /**
   * This singleton is lazy loaded.
   * @type {boolean}
   * @private
   */
  _inited: false,

  /**
   * Array of functions to call on a changes.
   * @type {VoidFunction[]}
   * @private
   */
  _change_callbacks: [],

  /**
   * data loaded/saved. For simplicity this data is public and should be read/modified directly
   */
  data: {
    audioEncoding: VOICESOUNDFORMAT.MP3_64,  // MP3_64, MP3_32
    effectsProfileId: VOICEPROFILE.MEDIUM_SPEAKERS,
    pitch: 0.0,
    speakingRate: 1.0,
    languageCode: 'en-US',    // is just derived form voice_name?
    testText: "Testing: 1,2,3",
    skipBackOnUnpause: 0.5,  // this is in seconds

    quota_size_warnings: true,
    quota_stop_at_size_wave: 1000000,  // 1 million
    quota_stop_at_size_std: 4000000,  // 4 million
    quota_last_reset_date_str: new Date().toLocaleString(),    // since a resent on one machine needs to be picked up by all instances.

    quota_all_unique_ids: [], // used by quota to get all data.

    // languageCode ... taken from voice_name
    // gender: comes from mapping the voice_name in the VoicesList2

    /**
     *  this one has an accessor since it keeps languageCode in sync. use Settings.currentVoiceName
     * @private
     */
    _voice_name: "en-US-Wavenet-A",  // use accessor so we can keep the languageCode lameness in sync
  },

  /**
   * This is considered sensitive or local-only data that is NOT synced to google's cross-machine syncing mechanism
   * @private
   */
  _data_local_only: {
    _unique_instance_id: '',   // this is used by quota syncing so prevent incr collisions across browser instances.
    _apikey: '',  // use accessor
  },

  /**
   * Set the voice name. It is the primary way to identify which voice is being used to Google
   * @param value {string}
   * @static
   */
  set currentVoiceName(value) {
    const {languageCode} = splitvoicename(value);
    Settings.data.languageCode = languageCode;
    Settings.data._voice_name = value;
  },

  /**
   * Voice ID
   * @return {string}
   * @static
   */
  get currentVoiceName() {
    return Settings.data._voice_name;
  },

  /**
   * Iterate over all the change callbacks and call them.
   * @private
   * @static
   */
  _dochangecallbacks() {
    Settings._change_callbacks.forEach((each_fn) => {
      if (each_fn) {
        queueMicrotask(each_fn);
      }
    });
  },

  /**
   * OK. to call mutiple times. It will initialize data from storage and set up listeners to keep it updated.
   * @param reload {any}
   * @return {Promise<void>}
   * @static
   */
  async init(reload = false) {
    try {
      if (Settings._inited === true) {
        return;
      }

      {  // init data stored locally.
        const storeddata = await asycChromeExt.getLocalStorageData('settings_local', Settings._data_local_only);
        Settings._data_local_only = {...Settings._data_local_only, ...storeddata};  // last item in list overwrites existing items.
        if (Settings._data_local_only._unique_instance_id === '') {
          // generate it and save it back out.
          Settings._data_local_only._unique_instance_id = generateUniqueId();
          // save it back out.
          await asycChromeExt.setLocalStorageData('settings_local', Settings._data_local_only);
        }
      }

      {  // init data stored remote
        const storeddata = await asycChromeExt.getRemoteStorageData('settings_remote', Settings.data)
        // now we merge in with this the data in the code. This handles the case when a new element is added to the
        // source, but the stored data is stale.
        Settings.data = {...Settings.data, ...storeddata};  // last item in list overwrites existing items.

        // is this id in the batch of all ids?
        if (!Settings.data.quota_all_unique_ids.includes(Settings.uniqueId)) {
          Settings.data.quota_all_unique_ids.push(Settings.uniqueId);
          await Settings.save();
        }

      }

      chrome.storage.onChanged.addListener(function (changes, namespace) {
        // namespace == "local" || "remote"... interesting.
        let something_changed = false;
        for (let key in changes) {
          if (!changes.hasOwnProperty(key)) {
            continue;
          }  // keeps linter happy

          const storageChange = changes[key].newValue;
          switch (key) {
            case 'settings_local':
              Settings._data_local_only = storageChange;
              something_changed = true;
              break;

            case 'settings_remote':
              Settings.data = storageChange;
              something_changed = true;
              break;
          }
        }
        // call once after everything updated
        if (something_changed) {
          trace('Settings.onchange changes ', changes);
          Settings._dochangecallbacks();
        }
      });


      Settings._inited = true;
    } catch (err) {
      logerr(err, err.stack);
    }
  },

  /**
   * Simplified callback. Add a function to be notified of the change.
   * Since Settings is a singleton, it doesn't pass data to the callback. Just access Singleton.
   * @param changefn {VoidFunction}
   * @return {Promise<void>}
   * @static
   */
  async addChangedListener(changefn) {
    Settings._change_callbacks.push(changefn);
  },

  /**
   * Call save when you've changed anything (Options page is the only one calling this right now)
   * @return {Promise<void>}
   * @static
   */
  async save() {
    try {
      const promiseremote = asycChromeExt.setRemoteStorageData('settings_remote', Settings.data);
      const promiselocal = asycChromeExt.setLocalStorageData('settings_local', Settings._data_local_only);
      await Promise.all([promiseremote, promiselocal]);
    } catch (err) {
      logerr(err, err.stack);
    }
  },

  /**
   * @return {string}
   * @static
   */
  get apiKey() {
    return Settings._data_local_only._apikey;
  },
  /**
   * @param value {string}
   * @static
   */
  set apiKey(value) {
    Settings._data_local_only._apikey = value;
  },

  /**
   * Used by quota syncing to avoid incr() collisions. (e.g. two instances trying to add at the same time)
   * @return {string}
   * @static
   */
  get uniqueId() {
    return Settings._data_local_only._unique_instance_id;
  },
};

const EMPTY_QUOTA = {
  char_count_std: 0,
  char_count_wave: 0,
  last_reset: new Date().toLocaleString(),
  last_save: new Date().toLocaleString(),
};

/**
 * Singleton that tries its darnest to track quota usage.
 * It uses chrome.storage to try and coordinate usage across all your web instances.
 * Google really really should supply and API to check the quota, but as of the text-to-speech betav1 this doesn't
 * exist.
 *
 * Some challenges:
 *   1. If you switch apiKeys, then it seems the storage should be smart and track them separately.
 *      On one hand, if you change your apiKey on the same account for security reasons, then it will under count.
 *      On the other, if you have multiple accounts to spread your usage out (which is kind of unethical since you
 *      really should pay Google... but as of writing this $16 if you mistakenly go 1 character over 1M threshold is a
 *      harsh cliff for some folks, but thankfully, google starts you off with $300 credit to figure it out.)
 *
 *      Answer: there's no way to really know what is the best answer.
 *      Letting the user decide is probably the best answer. But then the UI needs to communicate which quota
 *      is associated with which key... but apiKeys are sensitive and should not be synced to the cloud.
 *
 *   2. If the api is being used from different devices, the quota increases might stomp on each other. A trivial
 *      solution is to just store each quota count binned by machine (each machine incr it's own counter) then
 *      the actual quota is just the sum of all machines. But there's no "machine id", so each instance generates
 *      a guid and saves it to localstorage.
 */
export const QuotaTracker = {


  _quotadata: EMPTY_QUOTA,

  // NONE of these are saved
  _inited: false,
  _change_callbacks: [],
  // _recursion_mutex: false,
  _current_sha1: '',
  _current_apikey: '',  // used to track when it changes. sha256() is async call

  // safe to call multiple times.
  async init() {
    try {
      if (QuotaTracker._inited) {
        return;
      }

      trace(`QuotaTracker:init `);

      // make sure our internal state match current settings.
      await Settings.init();
      if (Settings.apiKey === '') {
        // this is invalid
        trace('empty apikey');
        return;
      }

      if (Settings.apiKey === QuotaTracker._current_apikey) {
        // nothing to do
        return;
      }

      await QuotaTracker.refreshApiKeyFromSettings(Settings.apiKey);

      // Listen for settings to change
      await Settings.addChangedListener(async () => {
        // a setting changed, maybe we care? (e.g. a remote reset changed, or our local apiKey changed)
        if (Settings.apiKey !== QuotaTracker._current_apikey) {
          await QuotaTracker.refreshApiKeyFromSettings(Settings.apiKey);
        }

        // todo: we need to figure out if the global reset date is newer than the per-machine one, if so, we need
        // to reset and adjust our date
      });

      // install change listener
      chrome.storage.onChanged.addListener(function (changes, namespace) {
        for (let key in changes) {
          if (!changes.hasOwnProperty(key)) {
            continue;
          }
          // quota keys are formated quota_sha256ofApiKey_machineid
          if (key.startsWith(`quota_`)) {
            if (key === QuotaTracker.currentQuotaKey) {
              const storageChange = changes[key];
              // unlike localStorage, chrome.storage serializes for us
              QuotaTracker.data = {...EMPTY_QUOTA, ...storageChange.newValue};   // last item in list overwrites existing items.
              QuotaTracker._dochangecallbacks();
            } else {
              // this is for a different browser instance
              debugger; // todo: remove sanity check
            }
          }
        }
      });

      QuotaTracker._inited = true;
    } catch (err) {
      console.log(err, err.stack);
    }
  },

  get currentQuotaKey() {
    if (QuotaTracker._current_sha1 === '' || Settings.uniqueId === '') {
      throw("Sha256 or id not initialized");
    }
    return `quota_${QuotaTracker._current_sha1}_${Settings.uniqueId}`;
  },

  // quota data is saved per-api key so switching keys doesn't confuse the count.
  /**
   *
   * @return {Promise<void>}
   */
  async refreshApiKeyFromSettings(apikey = '') {
    try {
      trace(`QuotaTracker:refreshApiKeyFromSettings newkey '${apikey}'`);
      await Settings.init();

      if (Settings.apiKey === QuotaTracker._current_apikey) {
        // already sit, ignore
        return;
      }

      // set it.
      QuotaTracker._current_sha1 = await sha1(apikey);
      QuotaTracker._current_apikey = apikey;  // not saved
      QuotaTracker._quotadata = await asycChromeExt.getRemoteStorageData(QuotaTracker.currentQuotaKey, EMPTY_QUOTA);
    } catch (err) {
      logerr(err);
    }

  },

  async save() {
    try {
      trace(`QuotaTracker:save`);
      QuotaTracker._quotadata.last_save = new Date().toLocaleString();
      await asycChromeExt.setRemoteStorageData(QuotaTracker.currentQuotaKey, QuotaTracker._quotadata);
      QuotaTracker._dochangecallbacks();
    } catch (err) {
      logerr(err, err.stack);
    }
  },

  _dochangecallbacks() {
    QuotaTracker._change_callbacks.forEach((each_fn) => {
      if (each_fn) {
        queueMicrotask(each_fn);
      }
    });
  },

  async addChangedListener(changefn) {
    QuotaTracker._change_callbacks.push(changefn);
  },

  async quotatime_reset() {
    trace(`QuotaTracker:quotatime_reset`);
    try {
      const now_str = new Date().toLocaleString();
      QuotaTracker._quotadata.char_count_std = 0;
      QuotaTracker._quotadata.char_count_wave = 0;
      QuotaTracker._quotadata.last_reset_str = now_str;
      Settings.data.quota_last_reset_date_str = now_str;
      await Promise.all([QuotaTracker.save(), Settings.save()]);
    } catch (err) {
      logerr(err, err.stack);
    }
    // QuotaTracker._recursion_mutex = false;
  },

  /**
   *
   * @param increase {number}
   * @param soundname {string}
   * @return {Promise<void>}
   */
  async quotacountIncr(increase = 0, voicename) {
    const {voiceModel} = splitvoicename(voicename)
    trace(`QuotaTracker:quotacount_inc ${increase} is_std_service: ${voiceModel}`);
    if (increase === 0) {
      return;
    }
    // QuotaTracker._recursion_mutex = true;
    try {
      if (voiceModel === VOICEMODEL.STANDARD) {
        QuotaTracker._quotadata.char_count_std += increase;
      } else {
        QuotaTracker._quotadata.char_count_wave += increase;
      }
      await QuotaTracker.save();
    } catch (err) {
      logerr(err, err.stack);
    }
    // QuotaTracker._recursion_mutex = false;
  },

  /**
   * Quotas try to work if this extension is installed on multiple devices. Sum up all totals now
   * @return {Promise<{last_reset: *, char_count_wave: number, char_count_std: number}>}
   */
  async get_quota_totals() {
    try {
      // we need to loop over all the machines and collect data on them, to do this we're going batch the settings
      // query up.
      const sha1 = QuotaTracker._current_sha1;
      const keysmap = {};
      Settings.data.quota_all_unique_ids.map((id) => keysmap[`quota_${sha1}_${id}`] = EMPTY_QUOTA);

      const alldata = await asycChromeExt.getRemoteStorageDataBulk(keysmap);
      let char_count_std_total = 0;
      let char_count_wave_total = 0;

      const quota_last_reset_date = new Date(Settings.data.quota_last_reset_date_str);
      for (const [key, value] of Object.entries(alldata)) {
        // check the last reset? e.g. a machine never
        const isnewer = new Date(value.last_save) > quota_last_reset_date;
        if (isnewer) {
          // we can use this it's not too old
          char_count_std_total += value.char_count_std || 0;
          char_count_wave_total += value.char_count_wave || 0;
        }
      }

      return {
        char_count_std: char_count_std_total,
        char_count_wave: char_count_wave_total,
        last_reset: new Date(QuotaTracker._quotadata.last_reset_str),
      }
    } catch (err) {
      logerr(err, err.stack);
      return {
        char_count_std: 0,
        char_count_wave: 0,
        last_reset: new Date(),
      }
    }
  },
};