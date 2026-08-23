import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { syncAll } from './sync';

const BACKGROUND_SYNC_TASK = 'BACKGROUND_SYNC_TASK';

// 🛡️ Define the Background Sync Mission
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    console.log('📡 [Background Pulse] Waking up for institutional sync...');
    await syncAll();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    console.warn('❌ [Background Pulse] Sync failed:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// 🚀 Register the Task
export async function registerBackgroundSyncTask() {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
        minimumInterval: 15 * 60, // 15 Minutes
        stopOnTerminate: false,   // 🛡️ Keep running if app is closed
        startOnBoot: true,        // 🛡️ Start automatically after phone restart
      });
      console.log('✅ [Background Pulse] Registration Success');
    }
  } catch (err) {
    console.warn('❌ [Background Pulse] Registration failed:', err);
  }
}

export async function unregisterBackgroundSyncTask() {
  if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)) {
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
  }
}
