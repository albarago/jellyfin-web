import globalize from 'lib/globalize';
import type {
    TranscodeTestCheckResult,
    TranscodeTestMediaInfo,
    TranscodeTestOutputInfo,
    TranscodeTestStreamResult,
    TranscodeTestStressPhase,
    TranscodeTestStressResult
} from '../api/useTranscodeTest';
import { codecName, rangeName } from './mediaNames';

export const checkName = (check: TranscodeTestCheckResult) => {
    const format = `${codecName(check.Codec)} ${globalize.translate('TranscodingTestBitDepth', check.BitDepth)}`;
    return check.Kind === 'Tonemap' ? 'HDR10 → SDR' : format;
};

/** What happened, in words. */
export const checkDetail = (check: TranscodeTestCheckResult) => {
    switch (check.Outcome) {
        case 'Passed':
            return globalize.translate('TranscodingTestDetailPassed');
        case 'Software':
            return globalize.translate(check.Kind === 'Tonemap' ? 'TranscodingTestDetailTonemapCpu' : 'TranscodingTestDetailFallback');
        case 'Failed': {
            if (check.FailedAfterDecoding) {
                // The decoder started, so a later step such as a filter or the encoder failed.
                const started = check.FramesDecoded ?
                    globalize.translate('TranscodingTestDetailFailedAfterFrames', check.FramesDecoded) :
                    globalize.translate('TranscodingTestDetailFailedAfterDecoding');
                return check.EnabledInSettings === false ? `${started} ${globalize.translate('TranscodingTestDetailOff')}` : started;
            }
            // A format the hardware lacks fails the same way as a broken one, so don't alarm when it is already off.
            return globalize.translate(check.EnabledInSettings === false ? 'TranscodingTestDetailFailedOff' : 'TranscodingTestDetailFailed');
        }
        case 'NotSupported':
            // Not one frame got through while H.264 works: the hardware lacks the format, and the setup is fine.
            if (check.ReferencePassed) {
                return globalize.translate(`TranscodingTestDetailNoHardware${check.Kind}`, checkName(check));
            }
            return globalize.translate(`TranscodingTestDetailNotSupported${check.Kind}`, check.Method ?? '');
        default:
            return globalize.translate('TranscodingTestDetailSkipped', check.Method ?? '');
    }
};

/**
 * ffmpeg's error for a check, or an empty string. It is prefixed with "ffmpeg:" unless the detail already ends with
 * "ffmpeg failed:", so a copied row keeps a separator between the two.
 */
export const checkError = (check: TranscodeTestCheckResult) => {
    if (!check.Error) {
        return '';
    }
    const plainFailure = check.Outcome === 'Failed' && !check.FailedAfterDecoding && check.EnabledInSettings !== false;
    return plainFailure ? check.Error : globalize.translate('TranscodingTestFfmpegError', check.Error);
};

const encodeCodecKeys: Record<string, string> = { hevc: 'Hevc', h265: 'Hevc', av1: 'Av1' };

/** What to change, in words, or an empty string. */
export const checkAdvice = (check: TranscodeTestCheckResult) => {
    if (check.Advice === 'None') {
        return '';
    }
    // HEVC and AV1 encoding have their own "Allow encoding in ... format" checkboxes. Turning off
    // "Enable hardware encoding" for them would also stop H.264 encoding on the GPU.
    const codecKey = check.Kind === 'Encode' && check.Advice === 'TurnOff' ? encodeCodecKeys[check.Codec.toLowerCase()] ?? '' : '';
    // Name the format the way the "Enable hardware decoding for" checkboxes do.
    return globalize.translate(`TranscodingTestAdvice${check.Advice}${check.Kind}${codecKey}`, codecName(check.Codec));
};

export const describeInput = (input: TranscodeTestMediaInfo) => {
    const parts = [
        input.Name,
        [
            input.Width && input.Height ? `${input.Width}×${input.Height}` : '',
            codecName(input.Codec),
            input.BitDepth ? globalize.translate('TranscodingTestBitDepth', input.BitDepth) : '',
            rangeName(input.VideoRangeType)
        ].filter(Boolean).join(' '),
        input.BitrateMbps ? `${input.BitrateMbps} Mbps` : '',
        input.Fps ? `${input.Fps} fps` : ''
    ];
    return parts.filter(Boolean).join(' · ');
};

export const describeOutput = (output: TranscodeTestOutputInfo) => {
    const size = output.Width && output.Height ? `${output.Width}×${output.Height} ` : '';
    let audio = '';
    if (output.AudioCodec) {
        const channels = output.AudioChannels === 2 ? globalize.translate('TranscodingTestStereo') : `${output.AudioChannels ?? ''} ch`;
        audio = ` + ${output.AudioCodec.toUpperCase()} ${channels}`;
    }
    return `${size}${codecName(output.Codec)} · ${output.BitrateMbps} Mbps${audio}`;
};

const where = (onGpu: boolean) => globalize.translate(onGpu ? 'TranscodingTestGpu' : 'TranscodingTestCpu');

export const describePipeline = (output: TranscodeTestOutputInfo) => {
    let tonemap = globalize.translate('TranscodingTestNone');
    if (output.Tonemap !== 'None') {
        tonemap = where(output.Tonemap === 'Hardware');
    }
    return globalize.translate('TranscodingTestPipeline', where(output.HardwareDecoding), where(output.HardwareEncoding), tonemap);
};

/**
 * A stress test frame rate with one to three decimals, such as "23.976", "24.0" or "23.96". The server rounds readings
 * so that one under the threshold never shows as equal to it.
 */
export const formatFps = (fps: number) => fps.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 3, useGrouping: false });

/** How the running stress test adds streams and when it stops, with the server's timing. */
export const stressRunningHelp = (stress: TranscodeTestStressResult) => globalize.translate(
    'StressTestRunningHelp',
    stress.RampSeconds,
    formatFps(stress.ThresholdFps),
    `${Math.round(stress.FpsRatio * 100)}%`,
    stress.Input?.Fps ?? '',
    stress.FailSeconds,
    stress.SettleSeconds
);

/**
 * A frame rate as a multiple of real time, such as "1.25×", or a dash when it can't be worked out. A reading under the
 * threshold is rounded down, so a stream that fell behind never shows as "1.00×".
 */
export const formatSpeed = (fps: number | null | undefined, sourceFps: number | null | undefined, thresholdFps?: number) => {
    if (fps == null || !sourceFps) {
        return '—';
    }
    const speed = fps / sourceFps;
    return `${(thresholdFps != null && fps < thresholdFps ? Math.floor((speed * 100) + 1e-6) / 100 : speed).toFixed(2)}×`;
};

/** A stream's frame rate for the table, "Did not start" for a stream that ended without a frame, or a dash. */
export const streamFps = (stream: TranscodeTestStreamResult, fps: number | null | undefined) => {
    if (fps != null) {
        return formatFps(fps);
    }
    return stream.Status === 'notStarted' ? globalize.translate('StressTestStreamNotStarted') : '—';
};

/** How fast one stream ran alone, in words, or an empty string before it is known. */
export const singleStreamSpeed = (stress: TranscodeTestStressResult) => {
    if (stress.SingleStreamFps == null || !stress.SourceFps) {
        return '';
    }
    return globalize.translate('StressTestSingleStream', stress.SingleStreamFps.toFixed(1), formatSpeed(stress.SingleStreamFps, stress.SourceFps, stress.ThresholdFps));
};

export const streamCount = (count: number) => (
    count === 1 ? globalize.translate('StressTestStreamCountOne') : globalize.translate('StressTestStreamCount', count)
);

/** The result of a stress test that ended because a stream fell behind, with how many streams were running then. */
export const limitSummary = (stress: TranscodeTestStressResult) => globalize.translate(
    'StressTestFinishedLimit',
    streamCount(stress.MaxStableStreams),
    // An older server does not send StreamsAtEnd; the most streams that ran is the same count for this ending.
    streamCount(stress.StreamsAtEnd || stress.PeakStreams),
    stress.FailedStreamId ?? '',
    stress.FailedStreamFps != null ? formatFps(stress.FailedStreamFps) : ''
);

/** The stress test's status chip: the phase while it runs, then how it ended. */
export type StressStatusKey = Exclude<TranscodeTestStressPhase, 'Finished'>
    | 'LimitReached' | 'MaxStreams' | 'NvencSessionLimit' | 'GpuMemoryFull' | 'CouldNotStart' | 'Cancelled' | 'Error';

export const stressStatusKey = (stress: TranscodeTestStressResult): StressStatusKey => {
    if (stress.Phase !== 'Finished') {
        return stress.Phase;
    }
    switch (stress.EndReason) {
        case 'LimitReached':
        case 'MaxStreams':
        case 'NvencSessionLimit':
        case 'Cancelled':
            return stress.EndReason;
        case 'GpuMemoryFull':
            return 'GpuMemoryFull';
        case 'StreamFailed':
        case 'StreamStalled':
            return stress.CouldNotStartStream ? 'CouldNotStart' : 'Error';
        default:
            return 'Error';
    }
};

/**
 * The result of a stress test that ended because a stream produced no frames, or because the newest stream never
 * started. When streams had kept up and the newest one never started, by stalling or by exiting before its first
 * frame, the kept-up count is the result, shown as a warning; otherwise it is an error. A stalled stream did start, so
 * it is said to have produced no frames rather than that the server could not start it.
 */
export const stallBanner = (stress: TranscodeTestStressResult): { severity: 'warning' | 'error', message: string } => {
    const parts: string[] = [];
    let severity: 'warning' | 'error' = 'error';
    if (stress.CouldNotStartStream) {
        severity = 'warning';
        parts.push(stress.EndReason === 'StreamStalled' ?
            globalize.translate('StressTestStartedNoFrames', streamCount(stress.MaxStableStreams), stress.FailedStreamId ?? '', stress.StartTimeoutSeconds) :
            globalize.translate('StressTestCouldNotStart', streamCount(stress.MaxStableStreams), stress.FailedStreamId ?? ''));
    } else {
        parts.push(globalize.translate('StressTestStalled', stress.FailedStreamId ?? ''));
    }
    // Only ffmpeg's error lines are shown as the cause; its other output stays in the log.
    parts.push(stress.Error ?
        globalize.translate('StressTestFfmpegError', stress.Error) :
        globalize.translate('StressTestFfmpegNoError'));
    // ffmpeg never opened the file and barely used the CPU: point at the storage rather than the GPU.
    if (stress.WaitingOnInput) {
        parts.push(globalize.translate('StressTestWaitingOnInput'));
    }
    return { severity, message: parts.join(' ') };
};

/**
 * The result of a stress test that ended because the GPU ran out of memory after streams kept up: the kept-up count
 * is the result, shown as a warning, with ffmpeg's memory error.
 */
export const gpuMemoryBanner = (stress: TranscodeTestStressResult): { severity: 'warning', message: string } => {
    const parts = [ globalize.translate('StressTestFinishedGpuMemory', streamCount(stress.MaxStableStreams), stress.FailedStreamId ?? '') ];
    if (stress.Error) {
        parts.push(globalize.translate('StressTestFfmpegError', stress.Error));
    }
    return { severity: 'warning', message: parts.join(' ') };
};
