'use strict';
import {asycChromeExt, jsonParseSafe, logerr} from "./misc.js";
import {DEFAULT_VOICES_DATA} from "./data_static.js";

export const VOICEMODEL = {
  WAVENET: 'Wavenet',
  STANDARD: 'Standard',
};

export const VOICESOUNDFORMAT = {
  MP3: 'MP3_32_KBPS',
  MP3_64: 'MP3_64_KBPS',
  LINEAR16: 'LINEAR16',
};

export const VOICEPROFILE = {
  WEARABLE: 'wearable-class-device',
  HANDSET: 'handset-class-device',
  HEADPHONE: 'headphone-class-device',
  SMALL_SPEAKERS: 'small-bluetooth-speaker-class-device',
  MEDIUM_SPEAKERS: 'medium-bluetooth-speaker-class-device',
  LARGE_SPEAKERS: 'large-home-entertainment-class-device',
  AUTO: 'large-automotive-class-device',
  IVR: 'telephony-class-application',
};

// export const VOICEGENDER = {
//   // NO idea why these are UPPERCASED like this.
//   MALE: 'MALE',
//   FEMALE: 'FEMALE',
// };


export const VoicesList = {
  _cached_voicelist: null,
  _cached_langcode: [],

  // * Probably want to use googlevoice_voicelist_map.
  async load(reload = false) {
    /**
     * This will attempt the following in this order:
     *   1. Load cached voice data from localStorage
     *   2. Use Default data cached hardcoded in extension (probably out of dat)
     * @return {Promise<{}>}
     * @private
     */

    if (!reload && VoicesList._cached_voicelist !== null) {
      return VoicesList._cached_voicelist;
    }

    if (reload) {
      // loads into SETTINGS._cached_voicelist
      await VoicesList._googlevoice_voicelist_refetch();
    }

    if (VoicesList._cached_voicelist === null) {   // will be empty if _googlevoice_voicelist_refetch failed too.
      // fall back to static data.
      VoicesList._cached_voicelist = await asycChromeExt.getLocalStorageData('VOICES_LIST_DATA', DEFAULT_VOICES_DATA);
    }
    return VoicesList._cached_voicelist;
  },


  /**
   * Will fetch latest voice data from Google using voice api key and save it to localstorage.
   * @return {Promise<boolean>}
   * @private
   */
  async _googlevoice_voicelist_refetch() {
    try {
      const data = await this.apiFetchVoices();
      if (data === false) {
        return false;
      }

      const data_json = jsonParseSafe(data);
      VoicesList._cached_voicelist = data_json.voices.sort((a, b) => {
        /** data looks like this in beta
        {
        "languageCodes": ["de-DE"],
        "name": "de-DE-Wavenet-F",
        "ssmlGender": "FEMALE",
        "naturalSampleRateHertz": 24000
        },
         */
        if (a.name !== b.name) {
          return (a.name > b.name) ? 1 : -1;
        } else {
          return (a.ssmlGender > b.ssmlGender) ? 1 : -1;
        }
      });
      await asycChromeExt.setLocalStorageData('VOICES_LIST_DATA', VoicesList._cached_voicelist);
      return true;
    } catch (err) {
      logerr(err, err.stack);
      return false;
    }
  },

  // get a list of languages ONLY showing ones in the voicelist
  getLangcodeFromVoicelist: () => {
    if (VoicesList._cached_langcode.length !== 0) { // lazy cache it.
      return VoicesList._cached_langcode;
    }

    const result = {};    // map, then grab keys to de-dup.
    VoicesList._cached_voicelist.forEach((a) => {
      try {
        const countrycode = a.languageCodes[0].split('-')[0];
        result[countrycode] = 1;
      } catch(err) {
        console.log(err, err.stack);
      }
    });

    VoicesList._cached_langcode = Object.keys(result).sort();
    return VoicesList._cached_langcode;
  },
};

