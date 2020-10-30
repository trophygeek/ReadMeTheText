'use strict';
import {logerr, trace, PLAYBACKSTATE, CMD, classGoogleTextToSpeech} from "./misc.js";
import {StateBus, Settings, QuotaTracker} from "./usersettings.js";


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


/** @var {classGoogleTextToSpeech} */
let gTxt2Speech = null;
let installed_menu = false;

/**
 *
 * @param text {string}
 * @return {Promise<boolean>}
 */
const playText = async (text = '') => {
  try {
    if (!gTxt2Speech) {
      // create a new playback object
      gTxt2Speech = new classGoogleTextToSpeech(async () => {
        // notified when the playback tops
        const new_state = gTxt2Speech.getPlaybackState();
        trace(`text_to_speech change state '${new_state}'`);
        await setToolbarIcon(new_state);
      });
    }

    const selectionText = gTxt2Speech.cleanupText(text) || '';
    if (selectionText.trim() === '') {
      return false;
    }

    const newCharCount = selectionText.length;

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

    const {success, charactercount} = await gTxt2Speech.apiFetchAudio(selectionText);
    if (success) {
      await gTxt2Speech.playTrack();
    }

    await QuotaTracker.quotacountIncr(newCharCount, Settings.currentVoiceName);

    // clear timer and restart to free resource
    // chrome.alarms.clear('FREE_MEM', () => {
    //   chrome.alarms.create('FREE_MEM', {delayInMinutes: 30.0});
    // });

  } catch (err) {
    logerr(err, err.stack);
  }
  return false;
};

const fetchAndPlaySound = async (text) => {
  try {
    await Settings.init();

    if (Settings.apiKey === '') {
      chrome.browserAction.setBadgeText({text: "!"});
      // we need to notify that they key is not set in the toolbar.
      return;
    }
    chrome.browserAction.setBadgeText({text: ""});  // clear
    await playText(text);
  } catch (err) {
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
      "title": `Speak "%s"`,    // todo: decide on an icon
      "contexts": ["selection"],
      // "onclick": async function (info, tab) {
      //   await playText(info.selectionText);
      // },
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

const setToolbarIcon = async (newstate) => {
  try {
    switch (newstate) {
      case PLAYBACKSTATE.IDLE:
      case PLAYBACKSTATE.STOPPED:
        chrome.browserAction.setIcon({
          path: {
            '16': "/icons/icon_16.png",
            '24': "/icons/icon_24.png",
            '32': "/icons/icon_32.png"
          },
          // tabId: tab.id
        });
        chrome.browserAction.setBadgeText({text: ""});  // clear
        break;

      case PLAYBACKSTATE.PLAYING:
        chrome.browserAction.setIcon({
          path: {
            '16': "/icons/play1_16.png",
            '24': "/icons/play1_24.png",
            '32': "/icons/play1_32.png"
          },
          // tabId: tab.id
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
        chrome.browserAction.setBadgeText({text: "!"});  // clear
        break;
    }
    StateBus.currentState = newstate;   // this broadcasts the new state to other modules if it's different.
  } catch (err) {
    logerr(err, err.stack);
  }
};

chrome.runtime.onMessage.addListener(async function (request, sender, sendResponse) {
  trace('chrome.runtime.onMessage');
  try {
    chrome.browserAction.setBadgeText({text: ""});  // clear
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
              await gTxt2Speech.playTrack();
              break;
          }
        }
        break;

      case CMD.PLAYTESTSOUND:
        // since we save the test sound text in Settings, we just access it that way.
        trace(`CMD.PLAYTESTSOUND: '${request.data}'`);
        await fetchAndPlaySound(request.data);
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
    await installMenu();
    // todo: check settings and if it's our first run open tab to show how to use.
  } catch (err) {
    logerr(err, err.stack);
  }
});

/** we're using this alarm to unload unused resources after 30 minutes of inactivity **/
// let rotationmod = 0;
// chrome.alarms.onAlarm.addListener(async function (alarm) {
//   trace('chrome.alarms.onAlarm');
//   chrome.browserAction.setBadgeText({text: ""});  // clear
//   await Settings.init();
//
//   switch (alarm.name) {
//     case 'FREE_MEM':
//       chrome.browserAction.setBadgeText({text: "freed"});  // our timer fired and we released memory
//       gTxt2Speech = null;
//       break;
//
//     case 'ANIMATE_TOOLBAR':
//       const nn = (rotationmod++ % 2) + 1; // 1 or 2
//       chrome.browserAction.setIcon({
//         path: {
//           '16': `/icons/play${nn}_16.png`,
//           '24': `/icons/play${nn}_24.png`,
//           '32': `/icons/play${nn}_32.png`,
//         },
//       });
//       break;
//   }
// });

async function main() {
  await Settings.init();
  await StateBus.init();
  chrome.browserAction.setBadgeText({text: ""});  // useful when debugging
  await installMenu();
}

chrome.runtime.onSuspend.addListener(function () {
  trace('chrome.runtime.onSuspend');
  chrome.browserAction.setBadgeText({text: "unload"});  // useful when debugging
  setToolbarIcon(PLAYBACKSTATE.IDLE);
});

chrome.runtime.onSuspendCanceled.addListener(async function () {
  trace('chrome.runtime.onSuspendCanceled');
  await main();
});

chrome.runtime.onStartup.addListener(async function () {
  trace('chrome.runtime.onStartup');
  await main();
});

// unittests();
trace('background.js done');

queueMicrotask(main);
