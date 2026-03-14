import { triggerDiscordMediaCacheCleanup } from '../channels/discord/media-cache.js';
import { logger } from '../logger.js';
import {
  cleanupManagedTempMediaDirectories,
  MANAGED_TEMP_MEDIA_DIR_PREFIXES,
} from '../media/managed-temp-media.js';

export async function runManagedMediaCleanup(
  reason: 'startup' | 'shutdown',
): Promise<void> {
  const cleanupTasks: Array<Promise<void> | null> = [
    triggerDiscordMediaCacheCleanup({ force: true }),
  ];
  if (reason === 'startup') {
    cleanupTasks.push(
      cleanupManagedTempMediaDirectories({
        prefixes: MANAGED_TEMP_MEDIA_DIR_PREFIXES,
      }),
    );
  }

  const results = await Promise.allSettled(cleanupTasks);

  const [discordCleanup, managedTempCleanup] = results;
  if (discordCleanup.status === 'rejected') {
    logger.warn(
      { error: discordCleanup.reason, reason },
      'Discord media cache cleanup failed',
    );
  }
  if (managedTempCleanup?.status === 'rejected') {
    logger.warn(
      { error: managedTempCleanup.reason, reason },
      'Managed temp media cleanup failed',
    );
  }
}
