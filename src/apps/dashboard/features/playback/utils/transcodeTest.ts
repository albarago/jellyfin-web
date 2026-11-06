import globalize from 'lib/globalize';
import type { TranscodeTestCheckResult, TranscodeTestMediaInfo, TranscodeTestOutputInfo, TranscodeTestStressResult } from '../api/useTranscodeTest';
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

/** How fast one stream ran alone, in words, or an empty string before it is known. */
export const singleStreamSpeed = (stress: TranscodeTestStressResult) => {
    if (stress.SingleStreamFps == null || !stress.SourceFps) {
        return '';
    }
    return globalize.translate('StressTestSingleStream', stress.SingleStreamFps.toFixed(1), formatSpeed(stress.SingleStreamFps, stress.SourceFps, stress.ThresholdFps));
};
