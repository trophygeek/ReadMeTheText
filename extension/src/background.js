'use strict';
import {logerr, trace, PLAYBACKSTATE, CMD, asycChromeExt} from "./misc.js";
import {StateBus, Settings, QuotaTracker} from "./usersettings.js";
import {TextToSpeech} from "./texttospeechclass.js";

// see https://cloud.google.com/text-to-speech/docs/reference/rest
// https://developer.chrome.com/extensions/background_migration
// to get typescript checking for extensions
//    1. create a parallel dir
//    2. run `npm init && npm install -D @types/chrome`
//    3. add project directory to this project.
const unittests = async () => {
  try {
    debugger;
  } catch (err) {
    logerr(err, err.stack);
    return false;
  }
}

/** @var {TextToSpeech} */
let gTxt2Speech = null;
let installed_menu = false;

/**
 *
 * @param text_to_play {string}
 * @return {Promise<boolean>}
 */
const playText = async (text_to_play = '') => {
  const handleErrorFn = async () => {
    logerr('handleError function called');
    const lasterr = gTxt2Speech.getLastError();
    await StateBus.setLastError(lasterr);
    await setToolbarIcon(PLAYBACKSTATE.ERROR, lasterr);
  };

  try {
    if (!gTxt2Speech) {
      // create a new playback object
      const voicename = Settings.currentVoiceName;
      gTxt2Speech = new TextToSpeech(Settings.apiKey, async () => {
        // notified when the playback stops
        const new_state = gTxt2Speech.getPlaybackState();
        trace(`text_to_speech change state '${new_state}'`);
        await setToolbarIcon(new_state);
      },async(count) => {
        trace(`incr quotacountIncr by ${count} for voicename:'${voicename}'`);
        await QuotaTracker.quotacountIncr(count, voicename);
      });
    }
    gTxt2Speech.setVoice(
      {
        audioEncoding: Settings.data.audioEncoding,
        effectsProfileId: Settings.data.effectsProfileId,
        pitch: Settings.data.pitch,
        speakingRate: Settings.data.speakingRate
      },
      {
        languageCode: Settings.data.languageCode,
        name: Settings.currentVoiceName,
      }
    );

    const cleaned_text = gTxt2Speech.cleanupText(text_to_play) || '';
    if (cleaned_text.trim() === '') {
      trace('trying to play empty text. what to do?');
      return false;
    }

    const newCharCount = cleaned_text.length;

    await QuotaTracker.init(); // make sure loaded in case we're unloaded

    // todo: there is a max quota size for text per request, verify it's not exceeded.
    const totals = await QuotaTracker.get_quota_totals();
    {
      // todo: process totals
      // if (Settings.data.quota_stop_at_size_std) {
      //
      // }
      // if (QuotaTracker.data.quota_size_warnings) {
      //   // we warn when we pass 50%, 80% and 95%.
      // }
    }
    // todo: check our estimated quota, if this would exceed it then notify.
    // if (quotaCharCount + newCharCount > ) { notify }

    await gTxt2Speech.stopTrack();  // no overlap
    const success = await gTxt2Speech.playTextToSpeech(cleaned_text);
    if (!success) {
      await handleErrorFn();
      return false;
    }
    await setToolbarIcon(PLAYBACKSTATE.PLAYING);

    return true;
  } catch (err) {
    logerr(err, err.stack);
    await handleErrorFn();
  }
  return false;
};

const fetchAndPlaySound = async (text) => {
  try {
    await Settings.init();

    if (!Settings.hasApiKey) {
      chrome.browserAction.setBadgeText({text: "!"});
      // we need to notify that they key is not set in the toolbar.
      return;
    }

    chrome.browserAction.setBadgeText({text: ""});  // clear
    const success = await playText(text);

  } catch (err) {
    logerr(err, err.stack);
  }
};

const fetchVoiceList = async() => {
  try {

  } catch(err) {
    logerr(err, err.stack);
  }
};

const installMenu = async (details) => {
  if (installed_menu) {
    return;
  }
  installed_menu = true;
  try {
    // no way to test if it exists.
    trace('chrome.contextMenus.removeAll ');
    chrome.contextMenus.removeAll();
  } catch (err) {
    console.log('did not find existing menu to remove');
  }

  try {
    // menu to start playing handler.
    trace('chrome.contextMenus.create ');
    chrome.contextMenus.create({
      "id": `text_to_speech_extension`,
      "title": `Speak "%s"`,      // todo: localize
      "contexts": ["selection"],
    });

    chrome.contextMenus.onClicked.addListener(async function (info, tab) {
      trace('chrome.contextMenus.onClicked ', info, tab);
      // warning: when developing, reloading the extension will cause this to be called twice
      if (info.menuItemId === `text_to_speech_extension`) {
        await fetchAndPlaySound(info.selectionText);
      }
    });
  } catch (err) {
    logerr(err, err.stack);
  }
};

/**
 *
 * @param newstate {string}
 * @param message {string}
 * @return {Promise<void>}
 */
const setToolbarIcon = async (newstate, message= "") => {
  try {
    trace(`setToolbarIcon('${newstate}')`);
    switch (newstate) {
      case PLAYBACKSTATE.NOKEY:
      case PLAYBACKSTATE.IDLE:
      case PLAYBACKSTATE.STOPPED:
        chrome.browserAction.setIcon({
          path: {
            '16': "/icons/icon_16.png",
            '24': "/icons/icon_24.png",
            '32': "/icons/icon_32.png"
          },
        });

        if (Settings.apiKey !== '') {
          chrome.browserAction.setBadgeText({text: ""});  // clear
        } else {
          // we need key
          chrome.browserAction.setBadgeText({text: "⚠"});
        }
        break;

      case PLAYBACKSTATE.PLAYING:
        chrome.browserAction.setIcon({
          path: {
            '16': "/icons/play1_16.png",
            '24': "/icons/play1_24.png",
            '32': "/icons/play1_32.png"
          },
        });

        chrome.browserAction.setBadgeText({text: ""});  // clear
        break;

      case PLAYBACKSTATE.PAUSED:
        chrome.browserAction.setIcon({
          path: {
            '16': "/icons/pause1_16.png",
            '24': "/icons/pause1_24.png",
            '32': "/icons/pause1_32.png"
          },
          // tabId: tab.id
        });
        chrome.browserAction.setBadgeText({text: ""});  // clear
        break;

      case PLAYBACKSTATE.DOWNLOADING:
        // todo: special icon?
        chrome.browserAction.setBadgeText({text: "↓"});  // clear
        break;

      case PLAYBACKSTATE.ERROR:
        chrome.browserAction.setBadgeText({text: "⚠"});
        break;
    }

    chrome.browserAction.setTitle({title: (message || "Select text on page and right click")});  // todo: localize


    await StateBus.setCurrentState(newstate);   // this broadcasts the new state to other modules if it's different.

  } catch (err) {
    logerr(err, err.stack);
  }
};

chrome.runtime.onMessage.addListener(async function (request, sender, sendResponse) {
  trace('chrome.runtime.onMessage');
  try {
    await Settings.init();
    switch (request.cmd) {
      case CMD.PAUSE:
        if (gTxt2Speech !== null) {
          await gTxt2Speech.pauseTrack();
        }
        break;

      case CMD.STOP:
        if (gTxt2Speech) {
          await gTxt2Speech.stopTrack();
        }
        break;

      case CMD.PLAY:
        if (gTxt2Speech) {
          const currentstate = gTxt2Speech.getPlaybackState();
          switch (currentstate) {
            case PLAYBACKSTATE.PLAYING:
              // we're already playing, ignore
              trace('already playing, ignoring');
              break;

            case PLAYBACKSTATE.PAUSED:
              await gTxt2Speech.unpauseTrack();
              break;

            default:
              const success = await gTxt2Speech.playTextToSpeech();
              break;
          }
        }
        break;

      case CMD.PLAYTESTSOUND:
        // since we save the test sound text in Settings, we just access it that way.
        trace(`CMD.PLAYTESTSOUND: '${request.data}'`);
        await fetchAndPlaySound(request.data);
        break;

      case CMD.REFRESHVOICES:
        await fetchVoiceList(request.data);
        break;
    }

  } catch (err) {
    logerr(err, err.stack);
  }
  if (sendResponse) {
    sendResponse({playbackstate: gTxt2Speech ? gTxt2Speech.getPlaybackState() : PLAYBACKSTATE.IDLE});
  }
});


chrome.runtime.onInstalled.addListener(async function (details) {
  try {
    trace('chrome.runtime.onInstalled.addListener');
    await Settings.init();
    await installMenu();
    await setToolbarIcon((Settings.apiKey === '') ? PLAYBACKSTATE.NOKEY : PLAYBACKSTATE.IDLE);

    chrome.tabs.create({
      url: `chrome-extension://${chrome.runtime.id}/src/setuphelp.html`
    });
  } catch (err) {
    logerr(err, err.stack);
  }
});

async function main() {
  await Settings.init();
  Settings.addChangedListener(async() => {
    if (StateBus.currentState === PLAYBACKSTATE.NOKEY) {
      if (Settings.hasApiKey) {
        await setToolbarIcon(PLAYBACKSTATE.IDLE);
      }
    }
  });
  await StateBus.init();
  await installMenu();

  await setToolbarIcon(PLAYBACKSTATE.IDLE);
}

chrome.runtime.onSuspend.addListener(async function () {
  trace('chrome.runtime.onSuspend');
  await Settings.init();
  await setToolbarIcon(PLAYBACKSTATE.IDLE);
  // remove our permissions to read the clipboard. TODO: add setting to not reprompt
  await asycChromeExt.chromePermissionsRevoke(['clipboardRead']);
  // chrome.browserAction.setBadgeText({text: "unload"});  // useful when debugging
});

chrome.runtime.onSuspendCanceled.addListener(async function () {
  trace('chrome.runtime.onSuspendCanceled');
  await main();
});

chrome.runtime.onStartup.addListener(async function () {
  await main();
});

// unittests();
trace('background.js done');

queueMicrotask(main);
