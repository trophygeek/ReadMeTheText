/** these constants are broken out to avoid a circular include between usersettings.js and voiceslist.js **/
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
