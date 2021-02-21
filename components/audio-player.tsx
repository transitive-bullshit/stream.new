import { useState, useEffect, useRef } from 'react'
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'
import Hls from 'hls.js'
import mux from 'mux-embed'
import logger from '../lib/logger'
import { breakpoints } from '../style-vars'

type Props = {
  playbackId: string
  onLoaded: () => void
  onError: (error: ErrorEvent) => void
}

const AudioPlayer: React.FC<Props> = ({ playbackId, onLoaded, onError }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playerRef = useRef<Plyr | null>(null)
  const [playerInitTime] = useState(Date.now())

  const mediaError = (event: ErrorEvent) => onError(event)

  useEffect(() => {
    const audio = audioRef.current
    const src = `https://stream.mux.com/${playbackId}.m3u8`
    let hls: Hls | null = null

    if (audio) {
      audio.addEventListener('error', mediaError)

      playerRef.current = new Plyr(audio, {
        // previewThumbnails: {
        //   enabled: true,
        //   src: `https://image.mux.com/${playbackId}/storyboard.vtt`
        // },
        storage: { enabled: false },
        fullscreen: {
          iosNative: true
        },
        debug: true
        // captions: { active: false, language: 'auto', update: true }
      })

      // audio.src = src
      // audio.onload = onLoaded
      playerRef.current.on('ready', onLoaded)

      if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        // This will run in safari, where HLS is supported natively
      } else if (Hls.isSupported()) {
        // This will run in all other modern browsers
        hls = new Hls()
        hls.loadSource(src)
        hls.attachMedia(audio)
        hls.on(Hls.Events.ERROR, function (event, data) {
          if (data.fatal) {
            logger.error('hls.js fatal error')
            mediaError(new ErrorEvent('HLS.js fatal error'))
          }
        })
      } else {
        console.error(
          // eslint-disable-line no-console
          'This is an old browser that does not support MSE https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API'
        )
      }

      console.log('mux', mux, process.env.NEXT_PUBLIC_MUX_ENV_KEY)

      if (typeof mux !== 'undefined' && process.env.NEXT_PUBLIC_MUX_ENV_KEY) {
        console.log('mux.monitor')
        mux.monitor(audio as HTMLVideoElement, {
          hlsjs: hls,
          Hls,
          data: {
            env_key: process.env.NEXT_PUBLIC_MUX_ENV_KEY,
            player_name: 'hls.js player v1',
            video_id: playbackId,
            video_title: playbackId,
            video_stream_type: 'on-demand',
            player_init_time: playerInitTime
          }
        })
        console.log('mux.monitor')
      }
    }

    return () => {
      if (audio) {
        audio.removeEventListener('error', mediaError)
      }

      // if (hls) {
      //   hls.destroy()
      // }
    }
  }, [playbackId, audioRef, onLoaded])

  return (
    <>
      <div className='audio-container'>
        <audio ref={audioRef} controls playsInline />
      </div>

      <style jsx>
        {`
          :global(:root) {
            --plyr-color-main: #1b1b1b;
            --plyr-range-fill-background: #ccc;
          }
          :global(.plyr__controls button),
          :global(.plyr__controls input) {
            cursor: pointer;
          }
          .audio-container {
            margin-bottom: 40px;
            margin-top: 40px;
            border-radius: 30px;
          }
          audio {
            display: block;
            max-width: 100%;
            max-height: 50vh;
            cursor: pointer;
          }
          @media only screen and (min-width: ${breakpoints.md}px) {
            audio {
              max-height: 70vh;
              min-width: 30rem;
            }
          }
          @media only screen and (max-width: ${breakpoints.md}px) {
            :global(.plyr__volume, .plyr__menu, .plyr--pip-supported
                [data-plyr='pip']) {
              display: none;
            }
            audio: {
              width: 100%;
              height: 100%;
            }
          }
        `}
      </style>
    </>
  )
}

export default AudioPlayer
