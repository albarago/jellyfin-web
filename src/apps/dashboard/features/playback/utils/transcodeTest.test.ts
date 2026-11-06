import { describe, expect, it, vi } from 'vitest';

import enUs from 'strings/en-us.json';

import type { TranscodeTestCheckResult, TranscodeTestStressResult } from '../api/useTranscodeTest';
import { checkAdvice, checkDetail, checkError, formatFps, formatSpeed, singleStreamSpeed, stressRunningHelp } from './transcodeTest';

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
