import AsyncStorage from '@react-native-community/async-storage'
import debounce from 'lodash/debounce'
import { NowPlayingItem } from 'podverse-shared'
import { getGlobal, setGlobal } from 'reactn'
import { translate } from '../lib/i18n'
import { getStartPodcastFromTime } from '../lib/startPodcastFromTime'
import { PV } from '../resources'
import { processValueTransactionQueue, saveStreamingValueTransactionsToTransactionQueue } from '../services/v4v/v4v'
import { handleEnrichingPlayerState, playerUpdatePlaybackState } from '../state/actions/player'
import { clearChapterPlaybackInfo, loadChapterPlaybackInfo } from '../state/actions/playerChapters'
import { startCheckClipEndTime, stopClipInterval } from '../state/actions/playerClips'
import { handleSleepTimerCountEvent } from '../state/actions/sleepTimer'
import { getBoostagramItemValueTags, v4vGetActiveProviderInfo } from '../state/actions/v4v/v4v'
import PVEventEmitter from './eventEmitter'
import {
  playerCheckIfStateIsPlaying,
  playerGetCurrentLoadedTrackId,
  playerGetPosition,
  playerGetState,
  playerHandlePauseWithUpdate,
  playerSetPositionWhenDurationIsAvailable,
  setClipHasEnded
} from './player'
import { getNowPlayingItemFromLocalStorage, setNowPlayingItemLocally } from './userNowPlayingItem'
import { removeQueueItem } from './queue'
import { addOrUpdateHistoryItem } from './userHistoryItem'

const debouncedSetPlaybackPosition = debounce(playerSetPositionWhenDurationIsAvailable, 1000, {
  leading: true,
  trailing: false
})

const handleSyncNowPlayingItem = async (trackId: string, currentNowPlayingItem: NowPlayingItem) => {
  if (!currentNowPlayingItem) return

  await clearChapterPlaybackInfo(currentNowPlayingItem)

  await setNowPlayingItemLocally(currentNowPlayingItem, currentNowPlayingItem.userPlaybackPosition || 0)
  if (currentNowPlayingItem && currentNowPlayingItem.clipId && !currentNowPlayingItem.clipIsOfficialChapter) {
    PVEventEmitter.emit(PV.Events.PLAYER_START_CLIP_TIMER)
  }

  if (!currentNowPlayingItem.liveItem) {
    if (currentNowPlayingItem && currentNowPlayingItem.clipId) {
      debouncedSetPlaybackPosition(currentNowPlayingItem.clipStartTime || 0)
    } else if (
      !currentNowPlayingItem.clipId &&
      currentNowPlayingItem.userPlaybackPosition &&
      currentNowPlayingItem.userPlaybackPosition >= 5
    ) {
      debouncedSetPlaybackPosition(currentNowPlayingItem.userPlaybackPosition, trackId)
    } else {
      const { podcastId } = currentNowPlayingItem
      const startPodcastFromTime = await getStartPodcastFromTime(podcastId)

      if (!currentNowPlayingItem.clipId && startPodcastFromTime) {
        debouncedSetPlaybackPosition(startPodcastFromTime, trackId)
      }
    }
  }

  PVEventEmitter.emit(PV.Events.PLAYER_TRACK_CHANGED)

  // Call addOrUpdateHistoryItem to make sure the current item is saved as the userNowPlayingItem.
  // I think this is necessary when the next episode plays from the background queue
  // outside of the usual loadPlayerItem process.
  // Also, keep the currentNowPlayingItem.userPlaybackPosition if available,
  // because if we use the currentPosition, then it will be a time position
  // less than 00:01, because there is a delay before debouncedSetPlaybackPosition
  // adjusts the timestamp to the correct position.
  const currentPosition = await playerGetPosition()
  addOrUpdateHistoryItem(
    currentNowPlayingItem,
    currentNowPlayingItem.userPlaybackPosition || currentPosition,
    currentNowPlayingItem.episodeDuration
  )

  handleEnrichingPlayerState(currentNowPlayingItem)
}

export const syncNowPlayingItemWithTrack = () => {
  stopClipInterval()

  // The first setTimeout is an attempt to prevent the following:
  // - Sometimes clips start playing from the beginning of the episode, instead of the start of the clip.
  // - Sometimes the debouncedSetPlaybackPosition seems to load with the previous track's playback position,
  // instead of the new track's playback position.
  // TODO: This timeout will lead to a delay before every clip starts, where it starts playing from the episode start
  // before playing from the clip start. Hopefully we can iron this out sometime...
  // - The second timeout is called in case something was out of sync previously from getCurrentTrack
  // or getNowPlayingItemFromLocalStorage...
  function sync() {
    (async () => {
      playerUpdatePlaybackState()
      await AsyncStorage.removeItem(PV.Keys.PLAYER_CLIP_IS_LOADED)

      const currentTrackId = await playerGetCurrentLoadedTrackId()
      const setPlayerClipIsLoadedIfClip = true

      /*
        When a new item loads, sometimes that item is not available in the local history
        until a few seconds into the playerLoadNowPlayingItem, so we're reattempting the
        getNowPlayingItemFromLocalStorage up to 5 times.
      */
      let retryIntervalCount = 1
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      const retryInterval = setInterval(async () => {
        retryIntervalCount += 1
        if (retryIntervalCount >= 5) {
          clearInterval(retryInterval)
        } else {
          const currentNowPlayingItem = await getNowPlayingItemFromLocalStorage(
            currentTrackId,
            setPlayerClipIsLoadedIfClip
          )
          if (currentNowPlayingItem && retryInterval) {
            clearInterval(retryInterval)
            await handleSyncNowPlayingItem(currentTrackId, currentNowPlayingItem)
            await removeQueueItem(currentNowPlayingItem)
            PVEventEmitter.emit(PV.Events.QUEUE_HAS_UPDATED)
          }
        }
      }, 1000)
    })()
  }

  setTimeout(sync, 1000)
}

const stopCheckClipIfEndTimeReached = () => {
  (async () => {
    const globalState = getGlobal()
    const { nowPlayingItem } = globalState.player
    if (nowPlayingItem) {
      const { clipEndTime } = nowPlayingItem
      const currentPosition = await playerGetPosition()
      if (clipEndTime && currentPosition > clipEndTime) {
        playerHandlePauseWithUpdate()
        await setClipHasEnded(true)
        stopClipInterval()
      }
    }
  })()
}

const debouncedHandlePlayerClipLoaded = debounce(startCheckClipEndTime, 1000)
PVEventEmitter.on(PV.Events.PLAYER_START_CLIP_TIMER, debouncedHandlePlayerClipLoaded)

const handleValueStreamingTimerIncrement = () => {
  const globalState = getGlobal()
  const { streamingValueOn } = globalState.session.v4v

  if (streamingValueOn) {
    playerGetState().then(async (playbackState) => {
      if (playerCheckIfStateIsPlaying(playbackState)) {
        valueStreamingIntervalSecondCount++

        if (valueStreamingIntervalSecondCount && valueStreamingIntervalSecondCount % 60 === 0) {
          await handleValueStreamingMinutePassed()
        }
      }

      if (valueStreamingIntervalSecondCount === 600) {
        valueStreamingIntervalSecondCount = 1

        const { errors, transactions, totalAmount } = await processValueTransactionQueue()
        if (transactions.length > 0 && totalAmount > 0) {
          setGlobal({
            bannerInfo: {
              show: true,
              description: translate('Streaming Value Sent'),
              errors,
              transactions,
              totalAmount
            }
          })
        }
      }
    })
  }
}

const handleValueStreamingMinutePassed = async () => {
  const globalState = getGlobal()
  const { nowPlayingItem } = globalState.player
  
  const valueTags = nowPlayingItem.episodeValue || nowPlayingItem.podcastValue || []
  
  const { activeProviderSettings } = v4vGetActiveProviderInfo(valueTags)
  const { activeProvider } = v4vGetActiveProviderInfo(getBoostagramItemValueTags(nowPlayingItem))
  const { streamingAmount } = activeProviderSettings || {}

  if (Array.isArray(valueTags) && valueTags.length > 0 && streamingAmount && activeProvider?.key) {
    await saveStreamingValueTransactionsToTransactionQueue(
      valueTags,
      nowPlayingItem,
      streamingAmount,
      activeProvider.key
    )
  }
}

let valueStreamingIntervalSecondCount = 1
let chapterIntervalSecondCount = 0
export const handleBackgroundTimerInterval = () => {
  const { chapterIntervalActive, clipIntervalActive, player } = getGlobal()
  const { sleepTimer } = player
  
  if (clipIntervalActive) {
    stopCheckClipIfEndTimeReached()
  }

  chapterIntervalSecondCount++
  if (chapterIntervalSecondCount >= 3) {
    chapterIntervalSecondCount = 0
    if (chapterIntervalActive) {
      loadChapterPlaybackInfo()
    }
  }

  if (sleepTimer?.isActive) {
    handleSleepTimerCountEvent()
  }

  handleValueStreamingTimerIncrement()
}
