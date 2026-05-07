import { pomoTimer, setPomoTimer } from '../state.js';

export function startPomoTimer(minutes, type = 'work') {
    const endTime = Date.now() + (minutes * 60 * 1000);
    setPomoTimer({ endTime, type, isActive: true, minutes });
    chrome.alarms.create('pomo-timer', { when: endTime });
    broadcastPomoState();
}

export function stopPomoTimer() {
    setPomoTimer({ endTime: null, type: null, isActive: false, minutes: null });
    chrome.alarms.clear('pomo-timer');
    broadcastPomoState();
}

/**
 * Push pomo state to all tabs that can receive messages.
 * Uses a targeted query — only non-discarded tabs — to avoid
 * hammering hibernated/unloaded tabs with silent failures.
 */
export function broadcastPomoState() {
    chrome.tabs.query({ discarded: false }, (tabs) => {
        for (const t of tabs) {
            chrome.tabs.sendMessage(t.id, { action: 'update-pomo-timer', pomoTimer }).catch(() => {});
        }
    });
}
