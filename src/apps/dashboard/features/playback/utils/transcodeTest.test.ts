import { describe, expect, it, vi } from 'vitest';

import enUs from 'strings/en-us.json';

import type { TranscodeTestCheckResult, TranscodeTestEndReason, TranscodeTestStreamResult, TranscodeTestStressPhase, TranscodeTestStressResult } from '../api/useTranscodeTest';
import { checkAdvice, checkDetail, checkError, formatFps, formatSpeed, gpuMemoryBanner, limitSummary, singleStreamSpeed, stallBanner, streamFps, stressRunningHelp, stressStatusKey, type StressStatusKey } from './transcodeTest';

const strings: Record<string, string | undefined> = enUs;

// Look strings up in the real en-us.json, so a missing key fails the test.
vi.mock('lib/globalize', () => ({
    default: {
        translate: (key: string, ...args: unknown[]) => {
            const text = strings[key];
            if (text === undefined) throw new Error(`Missing string: ${key}`);
            return text.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
        }
    }
}));

const check = (overrides: Partial<TranscodeTestCheckResult>): TranscodeTestCheckResult => ({
    Kind: 'Encode',
    Codec: 'h264',
    BitDepth: 8,
    Hdr: false,
    Outcome: 'Passed',
    Advice: 'None',
    ...overrides
});

describe('checkAdvice', () => {
    it('says nothing when there is nothing to change', () => {
        expect(checkAdvice(check({ Advice: 'None' }))).toBe('');
    });

    it('turns off hardware encoding when H.264 encoding fails', () => {
        expect(checkAdvice(check({ Outcome: 'Failed', Advice: 'TurnOff' })))
            .toBe(`Turn off “${strings.EnableHardwareEncoding}”.`);
    });

    it.each([
        ['hevc', strings.AllowHevcEncoding],
        ['av1', strings.AllowAv1Encoding]
    ])('turns off the allow checkbox, not hardware encoding, when %s encoding fails', (codec, label) => {
        const advice = checkAdvice(check({ Codec: codec, Outcome: 'Failed', Advice: 'TurnOff' }));

        expect(advice).toBe(`Turn off “${label}”.`);
        expect(advice).not.toContain(strings.EnableHardwareEncoding);
    });

    it('only ever advises turning on the hardware encoding switch', () => {
        const advice = checkAdvice(check({ Codec: 'av1', Advice: 'TurnOn' }));

        expect(advice).toBe(`Turn on “${strings.EnableHardwareEncoding}”.`);
    });

    it('names the format for decoding', () => {
        expect(checkAdvice(check({ Kind: 'Decode', Codec: 'vp9', Outcome: 'Failed', Advice: 'TurnOff' })))
            .toBe('Turn off VP9 under “Enable hardware decoding for”.');
    });
});

describe('checkDetail', () => {
    it('reports an ffmpeg failure when the setting is on', () => {
        expect(checkDetail(check({ Outcome: 'Failed', EnabledInSettings: true })))
            .toBe(strings.TranscodingTestDetailFailed);
    });

    it('stays calm about a failure when the setting is already off', () => {
        expect(checkDetail(check({ Kind: 'Decode', Codec: 'vp8', Outcome: 'Failed', EnabledInSettings: false })))
            .toBe(strings.TranscodingTestDetailFailedOff);
    });

    it('reports an ffmpeg failure when the setting is unknown', () => {
        expect(checkDetail(check({ Outcome: 'Failed' }))).toBe(strings.TranscodingTestDetailFailed);
    });

    it('leaves other outcomes alone', () => {
        expect(checkDetail(check({ Outcome: 'Passed', EnabledInSettings: false })))
            .toBe(strings.TranscodingTestDetailPassed);
    });
});

describe('checkDetail for a format the hardware lacks', () => {
    it('says the GPU can\'t decode it when not one frame decoded while H.264 decoding works', () => {
        expect(checkDetail(check({ Kind: 'Decode', Codec: 'av1', BitDepth: 10, Outcome: 'NotSupported', EnabledInSettings: true, ReferencePassed: true })))
            .toBe('This GPU can\'t decode AV1 10-bit; H.264 decoding works here, so the setup is fine.');
    });

    it('says the GPU can\'t encode it when not one frame encoded while H.264 encoding works', () => {
        expect(checkDetail(check({ Kind: 'Encode', Codec: 'av1', Outcome: 'NotSupported', ReferencePassed: true, Method: 'av1_nvenc' })))
            .toBe('This GPU can\'t encode AV1 8-bit; H.264 encoding works here, so the setup is fine.');
    });

    it('keeps the advice to turn it off', () => {
        const lacking = check({ Kind: 'Decode', Codec: 'av1', BitDepth: 10, Outcome: 'NotSupported', Advice: 'TurnOff', EnabledInSettings: true, ReferencePassed: true });
        expect(checkAdvice(lacking)).toBe(strings.TranscodingTestAdviceTurnOffDecode?.replace('{0}', 'AV1'));
    });

    it('shows the error after the detail', () => {
        expect(checkError(check({ Outcome: 'NotSupported', ReferencePassed: true, Error: 'Error while opening encoder' })))
            .toBe('ffmpeg: Error while opening encoder');
    });

    it('keeps the old text when Jellyfin has no hardware path at all', () => {
        expect(checkDetail(check({ Kind: 'Encode', Codec: 'av1', Outcome: 'NotSupported', Method: 'libsvtav1' })))
            .toBe('No hardware encoder for this format; Jellyfin uses libsvtav1 on the CPU.');
    });
});

// Every status the chip can show; the compiler keeps this list complete.
const STATUS_KEYS: Record<StressStatusKey, true> = {
    Starting: true,
    WarmingUp: true,
    KeepingUp: true,
    FallingBehind: true,
    LimitReached: true,
    MaxStreams: true,
    NvencSessionLimit: true,
    GpuMemoryFull: true,
    CouldNotStart: true,
    Cancelled: true,
    Error: true
};

describe('stress test status strings', () => {
    it.each(Object.keys(STATUS_KEYS))('has a label for %s', key => {
        expect(strings[`StressTestStatus${key}`]).toBeDefined();
    });

    it('names the endings as results, not as errors', () => {
        expect(strings.StressTestStatusLimitReached).toBe('Limit found');
        expect(strings.StressTestStatusMaxStreams).toBe('Reached maximum');
    });
});

describe('checkDetail after decoding started', () => {
    it('says the pipeline failed after the decoded frames', () => {
        expect(checkDetail(check({ Kind: 'Decode', Outcome: 'Failed', EnabledInSettings: true, FailedAfterDecoding: true, FramesDecoded: 30 })))
            .toBe('Decoding started, but the pipeline failed after 30 frame(s).');
    });

    it('says a later step failed when ffmpeg gave no count', () => {
        expect(checkDetail(check({ Kind: 'Decode', Outcome: 'Failed', FailedAfterDecoding: true })))
            .toBe(strings.TranscodingTestDetailFailedAfterDecoding);
    });

    it('keeps the guidance for a format that is off', () => {
        expect(checkDetail(check({ Kind: 'Decode', Outcome: 'Failed', EnabledInSettings: false, FailedAfterDecoding: true, FramesDecoded: 1 })))
            .toBe(`Decoding started, but the pipeline failed after 1 frame(s). ${strings.TranscodingTestDetailOff}`);
    });
});

describe('checkError', () => {
    it('is empty without an error', () => {
        expect(checkError(check({ Outcome: 'Failed' }))).toBe('');
    });

    it('follows "ffmpeg failed:" as it is', () => {
        expect(checkError(check({ Outcome: 'Failed', EnabledInSettings: true, Error: 'Conversion failed!' }))).toBe('Conversion failed!');
    });

    it('is introduced by "ffmpeg:" after any other detail', () => {
        expect(checkError(check({ Outcome: 'Failed', EnabledInSettings: false, Error: 'Conversion failed!' }))).toBe('ffmpeg: Conversion failed!');
        expect(checkError(check({ Outcome: 'Failed', FailedAfterDecoding: true, Error: 'Conversion failed!' }))).toBe('ffmpeg: Conversion failed!');
        expect(checkError(check({ Outcome: 'Skipped', Method: 'libsvtav1', Error: 'exit code 132, ended by signal 4' })))
            .toBe('ffmpeg: exit code 132, ended by signal 4');
    });
});

describe('formatSpeed', () => {
    it('shows the frame rate as a multiple of real time', () => {
        expect(formatSpeed(47.952, 23.976)).toBe('2.00×');
        expect(formatSpeed(21.6, 23.976)).toBe('0.90×');
    });

    it('never shows a stream under the threshold as real time', () => {
        expect(formatSpeed(23.9, 23.976, 23.976)).toBe('0.99×');
        expect(formatSpeed(23.975, 23.976, 23.976)).toBe('0.99×');
        expect(formatSpeed(21.6, 24, 24)).toBe('0.90×');
        expect(formatSpeed(23.976, 23.976, 23.976)).toBe('1.00×');
        expect(formatSpeed(47.952, 23.976, 23.976)).toBe('2.00×');
        // Without a threshold it rounds as usual.
        expect(formatSpeed(23.975, 23.976)).toBe('1.00×');
    });

    it('shows a dash without a frame rate or a source frame rate', () => {
        expect(formatSpeed(undefined, 23.976)).toBe('—');
        expect(formatSpeed(null, 23.976)).toBe('—');
        expect(formatSpeed(24, 0)).toBe('—');
    });
});

describe('singleStreamSpeed', () => {
    const stress = (overrides: Partial<TranscodeTestStressResult>) => ({ SourceFps: 23.976, ...overrides }) as TranscodeTestStressResult;

    it('says how fast one stream ran alone', () => {
        expect(singleStreamSpeed(stress({ SingleStreamFps: 271.8 })))
            .toBe('One stream alone ran at 271.8 fps (11.34× real time).');
    });

    it('rounds a single stream under the threshold down', () => {
        expect(singleStreamSpeed(stress({ SingleStreamFps: 23.9, ThresholdFps: 23.976 })))
            .toBe('One stream alone ran at 23.9 fps (0.99× real time).');
    });

    it('says nothing before it is known', () => {
        expect(singleStreamSpeed(stress({}))).toBe('');
    });
});

const END_REASONS: TranscodeTestEndReason[] = ['None', 'LimitReached', 'MaxStreams', 'StreamFailed', 'StreamStalled', 'NvencSessionLimit', 'Cancelled', 'Error', 'GpuMemoryFull'];
const PHASES: TranscodeTestStressPhase[] = ['Starting', 'WarmingUp', 'KeepingUp', 'FallingBehind'];
const FFMPEG_LINE = 'OpenEncodeSessionEx failed: incompatible client key (21)';

// Every ending × could-not-start × with and without ffmpeg's error.
const combinations = END_REASONS.flatMap(EndReason => [ false, true ].flatMap(
    CouldNotStartStream => [ undefined, FFMPEG_LINE ].map(error => ({ EndReason, CouldNotStartStream, Error: error }))
));

const finished = (overrides: Partial<TranscodeTestStressResult>) => ({
    Phase: 'Finished', MaxStableStreams: 8, FailedStreamId: 9, SourceFps: 23.976, StartTimeoutSeconds: 30, ...overrides
}) as TranscodeTestStressResult;

// What the page shows for every ending that isn't a capacity result. An older server never sends GpuMemoryFull.
const KEYS_BEFORE: Record<TranscodeTestEndReason, string> = {
    None: 'Error',
    LimitReached: 'LimitReached',
    MaxStreams: 'MaxStreams',
    StreamFailed: 'Error',
    StreamStalled: 'Error',
    NvencSessionLimit: 'NvencSessionLimit',
    Cancelled: 'Cancelled',
    Error: 'Error',
    GpuMemoryFull: 'GpuMemoryFull'
};

describe('stressStatusKey', () => {
    it.each(combinations)('$EndReason, could not start $CouldNotStartStream', c => {
        const key = stressStatusKey(finished(c));
        const capacity = (c.EndReason === 'StreamStalled' || c.EndReason === 'StreamFailed') && c.CouldNotStartStream;

        expect(key).toBe(capacity ? 'CouldNotStart' : KEYS_BEFORE[c.EndReason]);
        expect(strings[`StressTestStatus${key}`]).toBeDefined();
    });

    it.each(PHASES)('shows the phase %s while running', Phase => {
        expect(stressStatusKey(finished({ Phase, EndReason: 'None' }))).toBe(Phase);
    });
});

describe('stallBanner', () => {
    const stalls = combinations.filter(c => c.EndReason === 'StreamStalled');

    it.each(stalls)('could not start $CouldNotStartStream, error $Error', c => {
        const { severity, message } = stallBanner(finished(c));

        expect(severity).toBe(c.CouldNotStartStream ? 'warning' : 'error');
        if (c.CouldNotStartStream) {
            expect(message).toContain('8 streams kept up with real time');
            expect(message).toContain('stream 9 started and produced no frames in 30 s');
            expect(message).not.toContain('stopped because');
        } else {
            expect(message).toContain('stopped because stream 9 produced no frames');
        }
        if (c.Error) {
            expect(message).toContain(`ffmpeg's error: ${FFMPEG_LINE}`);
        } else {
            expect(message).toContain('ffmpeg printed no error.');
        }
    });

    it('never blames NVIDIA for a stream that never started', () => {
        const { message } = stallBanner(finished({ EndReason: 'StreamStalled', CouldNotStartStream: true, MaxStableStreams: 4, FailedStreamId: 5 }));

        expect(message).not.toMatch(/NVIDIA|session/i);
        expect(message).toBe(`${strings.StressTestStartedNoFrames?.replace('{0}', '4 streams').replace('{1}', '5').replace('{2}', '30')} ${strings.StressTestFfmpegNoError}`);
        expect(message).toContain('stream 5 started and produced no frames in 30 s');
        expect(message).not.toContain('could not start');
    });

    it.each([ undefined, FFMPEG_LINE ])('warns for an early exit of the newest stream as for a stall, but says it could not start, error %s', error => {
        const exit = stallBanner(finished({ EndReason: 'StreamFailed', CouldNotStartStream: true, MaxStableStreams: 4, FailedStreamId: 5, Error: error }));
        const stall = stallBanner(finished({ EndReason: 'StreamStalled', CouldNotStartStream: true, MaxStableStreams: 4, FailedStreamId: 5, Error: error }));
        expect(exit.severity).toBe('warning');
        expect(stall.severity).toBe('warning');
        expect(exit.message).toContain('the server could not start stream 5');
        expect(stall.message).toContain('stream 5 started and produced no frames in 30 s');
    });

    it('points at the storage when ffmpeg was waiting on reading the file', () => {
        const { severity, message } = stallBanner(finished({ EndReason: 'StreamStalled', CouldNotStartStream: true, MaxStableStreams: 4, FailedStreamId: 5, WaitingOnInput: true }));

        expect(severity).toBe('warning');
        expect(message).toContain('stream 5 started and produced no frames in 30 s');
        expect(message).toBe(`${strings.StressTestStartedNoFrames?.replace('{0}', '4 streams').replace('{1}', '5').replace('{2}', '30')} ${strings.StressTestFfmpegNoError} ${strings.StressTestWaitingOnInput}`);
        expect(message).toContain('Slow or shared storage, not the GPU, may be the limit.');
    });

    it.each([ false, undefined ])('gives no storage hint when ffmpeg was not waiting on the file (%s)', waiting => {
        const { message } = stallBanner(finished({ EndReason: 'StreamStalled', CouldNotStartStream: true, WaitingOnInput: waiting }));

        expect(message).not.toContain('storage');
    });

    it('treats a result from an older server, without the new fields, as an error', () => {
        const { severity, message } = stallBanner(finished({ EndReason: 'StreamStalled' }));

        expect(severity).toBe('error');
        expect(message).toBe(`${strings.StressTestStalled?.replace('{0}', '9')} ${strings.StressTestFfmpegNoError}`);
    });
});

describe('streamFps', () => {
    const stream = (Status: TranscodeTestStreamResult['Status']): TranscodeTestStreamResult => ({ Id: 5, Status });

    it('says a stream that ended without a frame did not start', () => {
        expect(streamFps(stream('notStarted'), undefined)).toBe('Did not start');
    });

    it.each([ 'running', 'stopped', 'failed' ] as const)('shows a dash for a %s stream without a reading', status => {
        expect(streamFps(stream(status), undefined)).toBe('—');
    });

    it('shows the reading when there is one', () => {
        expect(streamFps(stream('stopped'), 23.96)).toBe('23.96');
    });
});

describe('gpuMemoryBanner', () => {
    const CUDA_LINE = 'cuvidCreateDecoder(&ctx->cudecoder, &cuinfo) failed -> CUDA_ERROR_OUT_OF_MEMORY: out of memory';

    it.each([ undefined, CUDA_LINE ])('error %s', error => {
        const { severity, message } = gpuMemoryBanner(finished({ EndReason: 'GpuMemoryFull', MaxStableStreams: 15, FailedStreamId: 16, Error: error }));
        expect(severity).toBe('warning');
        expect(message).toContain('15 streams kept up with real time');
        expect(message).toContain('ran out of memory on stream 16');
        expect(message).not.toMatch(/session/i);
        expect(message.includes(`ffmpeg's error: ${CUDA_LINE}`)).toBe(error !== undefined);
    });

    it('names one stream in the singular', () => {
        expect(gpuMemoryBanner(finished({ EndReason: 'GpuMemoryFull', MaxStableStreams: 1, FailedStreamId: 2 })).message)
            .toContain(strings.StressTestStreamCountOne);
    });
});

describe('limitSummary', () => {
    it('says how many streams were running when one fell behind', () => {
        expect(limitSummary(finished({ EndReason: 'LimitReached', MaxStableStreams: 4, StreamsAtEnd: 5, PeakStreams: 5, FailedStreamId: 5, FailedStreamFps: 20 })))
            .toBe('Stress test finished: 4 streams kept up with real time. With 5 streams running, stream 5 fell to 20.0 fps.');
    });

    it('uses the most streams that ran for a result from an older server', () => {
        expect(limitSummary(finished({ EndReason: 'LimitReached', MaxStableStreams: 1, PeakStreams: 2, FailedStreamId: 2, FailedStreamFps: 23.96 })))
            .toBe('Stress test finished: 1 stream kept up with real time. With 2 streams running, stream 2 fell to 23.96 fps.');
    });
});

describe('formatFps', () => {
    it('shows the threshold at the source precision and readings with at least one decimal', () => {
        expect(formatFps(23.976)).toBe('23.976');
        expect(formatFps(23.96)).toBe('23.96');
        expect(formatFps(24)).toBe('24.0');
        expect(formatFps(1271.8)).toBe('1271.8');
    });
});

describe('stressRunningHelp', () => {
    it('says a stream is added at most every interval, once every running stream has kept up for the settle window', () => {
        const stress = {
            Phase: 'KeepingUp', RampSeconds: 12, SettleSeconds: 3, FailSeconds: 5, ThresholdFps: 23.976, FpsRatio: 1,
            Input: { Name: 'Movie', Fps: 23.976 }
        } as TranscodeTestStressResult;

        expect(stressRunningHelp(stress)).toBe(
            'Stress test is running. Each stream must keep at least 23.976 fps (100% of the movie\'s 23.976 fps). '
            + 'A stream is added at most every 12 s, once every running stream has kept up for 3 s. '
            + 'It stops when a stream falls behind for 5 s, or at the maximum number of streams configured above.'
        );
    });
});

describe('StressTestHelp', () => {
    it('states the same rule as the running help', () => {
        expect(strings.StressTestHelp).toContain('adds a stream at most every {0} seconds, once every running stream has kept up for {1} seconds');
    });
});
