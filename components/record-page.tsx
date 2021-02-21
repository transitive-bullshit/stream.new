/* global navigator MediaRecorder Blob File */
/* eslint-disable jsx-a11y/no-onchange */
import { useRef, useEffect, useState, ChangeEvent } from 'react'
import Layout from './layout'
import StopWatch from './stop-watch'
import RecordingControls from './recording-controls'
import CameraOptions from './camera-options'
import AccessSkeletonFrame from './access-skeleton-frame'
import UploadProgressFullpage from './upload-progress-fullpage'
import logger from '../lib/logger'
import CountdownTimer, { CountdownTimerHandles } from './countdown-timer'
import { RecordState } from '../types'

const MEDIA_RECORDER_TIMESLICE_MS = 2000

const getAudioContext = () =>
  (typeof window !== undefined && window.AudioContext) ||
  window.webkitAudioContext

type DeviceItems = MediaDeviceInfo[]

type DeviceList = {
  // video: DeviceItems
  audio: DeviceItems
}

const RecordPage: React.FC<NoProps> = () => {
  const [errorMessage, setErrorMessage] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [startRecordTime, setStartRecordTime] = useState<number | null>(null)
  const [recordState, setRecordState] = useState(RecordState.IDLE)
  const [isRequestingMedia, setIsRequestingMedia] = useState(false)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [isReviewing, setIsReviewing] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [haveDeviceAccess, setHaveDeviceAccess] = useState(false)
  const [isMicDeviceEnabled, setIsMicDeviceEnabled] = useState(false)
  // const [videoDeviceId, setVideoDeviceId] = useState('')
  const [audioDeviceId, setAudioDeviceId] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioInterval = useRef<number | null>(null)
  const mediaChunks = useRef<Blob[]>([])
  const finalBlob = useRef<Blob | null>(null)
  const countdownTimerRef = useRef<CountdownTimerHandles | null>(null)
  const [deviceList, setDevices] = useState({
    audio: []
  } as DeviceList)
  const [showUploadPage, setShowUploadPage] = useState(true)

  const getDevices = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const list: DeviceList = { audio: [] }

    devices.forEach((device) => {
      if (device.kind === 'audioinput') {
        list.audio.push(device)
      }
    })

    setDevices({ ...list })
  }

  const updateAudioLevels = (analyser: AnalyserNode) => {
    // dataArray will give us an array of numbers ranging from 0 to 255
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(dataArray)
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length
    // these values are between 0 - 255, we want the average and
    // to convert it into a value between 0 - 100
    const audioLevelValue = Math.round((average / 255) * 100)
    setAudioLevel(audioLevelValue)
  }

  const stopUserMedia = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        logger('stopping track', track.kind, track.label)
        track.stop()
      })
    }
    streamRef.current = null
  }

  /*
   * Stop all recording, cancel audio interval
   */
  const cleanup = () => {
    logger('cleanup')
    if (recorderRef.current) {
      if (recorderRef?.current?.state === 'inactive') {
        logger('skipping recorder stop() b/c state is "inactive"')
      } else {
        recorderRef.current.onstop = function onRecorderStop() {
          logger('recorder cleanup')
        }
        recorderRef.current.stop()
      }
    }
    mediaChunks.current = []
    if (audioInterval.current) {
      clearInterval(audioInterval.current)
    }
    setRecordState(RecordState.IDLE)
    setErrorMessage('')
    setShowUploadPage(false)
  }

  /*
   * do a cleanup, and also cancel all media streams
   */
  const hardCleanup = () => {
    cleanup()
    stopUserMedia()
    setIsReviewing(false)
    setIsLoadingPreview(false)
    setHaveDeviceAccess(false)
    setIsMicDeviceEnabled(false)
    // setVideoDeviceId('')
    setAudioDeviceId('')
  }

  const startAv = () => {
    cleanup()
    startCamera()
  }

  const setupStream = (stream: MediaStream) => {
    const AudioContext = getAudioContext()

    if (AudioContext) {
      const audioContext = new AudioContext()
      const mediaStreamSource = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.smoothingTimeConstant = 0.3
      analyser.fftSize = 1024
      mediaStreamSource.connect(analyser)

      audioInterval.current = window.setInterval(() => {
        updateAudioLevels(analyser)
      }, 100)
    }

    streamRef.current = stream

    if (audioRef.current !== null) {
      ;(audioRef.current as HTMLAudioElement).srcObject = stream
      audioRef.current.muted = true
      audioRef.current.controls = false
    }
    setHaveDeviceAccess(true)
  }

  const startCamera = async () => {
    if (navigator.mediaDevices) {
      const audio = audioDeviceId ? { deviceId: audioDeviceId } : true
      const constraints = { video: false, audio }

      try {
        /*
         * We have to call getDevices() twice b/c of firefox.
         * The first time we getDevices() in firefox the device.label is an empty string
         * After getUserMedia() happens successfully, then we can getDevices() again to
         * and the 2nd time then device.label will be populated :shrug:
         */
        await getDevices()
        logger('requesting user media with constraints', constraints)

        /*
         * This gets called when a new device is selected, we want to stopUserMedia()
         * when re-initializing a camera
         *
         * You will notice that in startScreenshare() we do not call stopUserMedia()
         * because we want the screenshare to stay the same while the microphone input
         * gets changed
         */
        stopUserMedia()

        setIsRequestingMedia(true)
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        setIsRequestingMedia(false)
        setErrorMessage('')

        await getDevices()
        setupStream(stream)
      } catch (err) {
        logger.error('getdevices error', err)
        setIsRequestingMedia(false)
        setErrorMessage(
          'Error getting devices, you may have denied access already, if so you will have to allow access in browser settings.'
        )
      }
    } else {
      setErrorMessage('navigator.mediaDevices not available in this browser')
    }

    return function teardown() {
      hardCleanup()
    }
  }

  const reset = async () => {
    hardCleanup()
  }

  useEffect(() => {
    //
    // This updates the device list when the list changes. For example
    // plugging in or unplugging a mic or camera
    //
    navigator.mediaDevices.ondevicechange = getDevices
  }, [])

  useEffect(() => {
    if (isMicDeviceEnabled || audioDeviceId) {
      startAv()
    }
  }, [audioDeviceId, isMicDeviceEnabled])

  const prepRecording = () => {
    logger('prep recording')

    if (typeof MediaRecorder === 'undefined') {
      setErrorMessage(
        'MediaRecorder not available in your browser. You may be able to enable this in Experimental Features'
      )
      return
    }

    countdownTimerRef.current?.start()
    setRecordState(RecordState.PREPARING)
  }

  const startRecording = async () => {
    if (isRecording) {
      logger.warn('we are already recording')
      return
    }

    if (isReviewing) {
      logger.warn(
        'cannot start recording when you are reviewing your last recording'
      )
      return
    }

    logger('start recording')

    try {
      setStartRecordTime(new Date().valueOf())

      // const preferredOptions = { mimeType: 'video/webm;codecs=vp9' }
      // const backupOptions = { mimeType: 'video/webm;codecs=vp8,opus' }
      // const preferredOptions = { mimeType: 'audio/mp4; codecs=mp4a.40.2' }
      const preferredOptions = { mimeType: 'audio/webm; codecs=opus' }
      const backupOptions = { mimeType: 'audio/webm' }
      let options = preferredOptions

      /*
       * MediaRecorder.isTypeSupported is not a thing in safari,
       * good thing safari supports the preferredOptions
       */
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        if (!MediaRecorder.isTypeSupported(preferredOptions.mimeType)) {
          options = backupOptions
        }
      }

      const stream = streamRef.current
      if (!stream) throw new Error('Cannot record without a stream')

      recorderRef.current = new MediaRecorder(stream, options)
      recorderRef.current.start(MEDIA_RECORDER_TIMESLICE_MS)
      recorderRef.current.ondataavailable = (evt) => {
        mediaChunks.current.push(evt.data)
        logger('added media recorder chunk', mediaChunks.current.length)
      }

      setRecordState(RecordState.RECORDING)
    } catch (err) {
      logger.error(err) // eslint-disable-line no-console
      setErrorMessage(
        'Error attempting to start recording, check console for details'
      )
    }
  }

  const cancelRecording = () => {
    countdownTimerRef.current?.reset()
    cleanup()
  }

  const stopRecording = () => {
    if (!recorderRef.current) {
      logger.warn('cannot stopRecording() without a recorderRef')
      return
    }

    recorderRef.current.onstop = function onRecorderStop() {
      finalBlob.current = new Blob(mediaChunks.current, { type: 'audio/webm' })
      const objUrl = URL.createObjectURL(finalBlob.current)

      if (audioRef.current !== null) {
        audioRef.current.srcObject = null
        audioRef.current.src = objUrl
        audioRef.current.controls = true
        audioRef.current.muted = false
        setIsReviewing(true)
      }

      cleanup()
    }

    recorderRef.current.stop()
    stopUserMedia()
  }

  const submitRecording = () => {
    if (!finalBlob.current) {
      logger.error('Cannot submit recording without a blob')
      return
    }

    const createdFile = new File([finalBlob.current], 'audio-recording', {
      type: finalBlob.current.type
    })

    setFile(createdFile)
    setShowUploadPage(true)
  }

  const muteAudioTrack = (shouldMute: boolean) => {
    if (streamRef.current) {
      streamRef.current
        .getTracks()
        .filter((track) => track.kind === 'audio')
        .forEach((track) => {
          track.enabled = !shouldMute
        })
    }
  }

  const selectAudio = (evt: ChangeEvent<HTMLSelectElement>) => {
    setAudioDeviceId(evt.target.value)
  }

  if (file && showUploadPage) {
    return <UploadProgressFullpage file={file} resetPage={hardCleanup} />
  }

  const isMuted = (): boolean => {
    if (streamRef.current) {
      return !!streamRef.current
        .getTracks()
        .filter((track) => track.kind === 'audio' && !track.enabled).length
    }

    return false
  }

  const isRecording = recordState === RecordState.RECORDING

  return (
    <Layout title='stream.new' description='Record audio' centered>
      <h1>
        {(isRecording && startRecordTime && (
          <StopWatch startTimeUnixMs={startRecordTime} />
        )) ||
          'Recording setup'}
      </h1>

      {errorMessage && <div className='error-message'>{errorMessage}</div>}

      <div className='skeleton-container'>
        {!haveDeviceAccess && (
          <AccessSkeletonFrame
            onClick={startCamera}
            text={
              isRequestingMedia
                ? 'Loading device...'
                : 'Allow the browser to use your mic'
            }
          />
        )}
      </div>

      <div className='audio-container'>
        <audio ref={audioRef} autoPlay />

        <CountdownTimer ref={countdownTimerRef} onElapsed={startRecording} />
      </div>

      <div>{isLoadingPreview && 'Loading preview...'}</div>

      {haveDeviceAccess && (
        <CameraOptions
          isLoadingPreview={isLoadingPreview}
          isRecording={isRecording}
          isMuted={isMuted()}
          muteAudioTrack={muteAudioTrack}
          deviceList={deviceList}
          audioLevel={audioLevel}
          selectAudio={selectAudio}
        />
      )}

      {haveDeviceAccess && (
        <RecordingControls
          recordState={recordState}
          isLoadingPreview={isLoadingPreview}
          isReviewing={isReviewing}
          startRecording={prepRecording}
          cancelRecording={cancelRecording}
          stopRecording={stopRecording}
          submitRecording={submitRecording}
          reset={reset}
        />
      )}

      <style jsx>
        {`
          .error-message {
            color: #c9473f;
            max-width: 400px;
            padding-bottom: 20px;
            text-align: center;
            line-height: 24px;
          }
          .skeleton-container {
            width: 100%;
            display: flex;
            justify-content: center;
          }
          .audio-container {
            position: relative;
          }
          audio {
            display: ${haveDeviceAccess ? 'block' : 'none'};
            border-radius: 30px;
          }
          h1 {
            margin-top: 3vh;
            font-size: 3.5vw;
          }
        `}
      </style>
    </Layout>
  )
}

export default RecordPage
