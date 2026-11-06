import React, { type FC, useCallback, useEffect, useMemo, useState } from 'react';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import globalize from 'lib/globalize';
import type { TranscodeTestRequest, TranscodeTestStatus, TranscodeTestStressResult } from '../api/useTranscodeTest';
import { useTestMediaSearch } from '../api/useTestMediaSearch';
import { describeInput, describeOutput, describePipeline, formatFps, stressRunningHelp } from '../utils/transcodeTest';
import TestConsole from './TestConsole';

interface Target {
    id: string
    label: string
    codec: string
    maxWidth: number
    bitrate: number
}

const TARGETS: Target[] = [
    { id: '2160-hevc', label: '4K HEVC 20 Mbps', codec: 'hevc', maxWidth: 3840, bitrate: 20_000_000 },
    { id: '1080-h264', label: '1080p H.264 8 Mbps', codec: 'h264', maxWidth: 1920, bitrate: 8_000_000 },
    { id: '1080-hevc', label: '1080p HEVC 8 Mbps', codec: 'hevc', maxWidth: 1920, bitrate: 8_000_000 },
    { id: '720-h264', label: '720p H.264 4 Mbps', codec: 'h264', maxWidth: 1280, bitrate: 4_000_000 },
    { id: '480-h264', label: '480p H.264 2 Mbps', codec: 'h264', maxWidth: 854, bitrate: 2_000_000 }
];

// These match the server's stress test timing.
const RAMP_SECONDS = 12;
const SETTLE_SECONDS = 3;

const formatItem = (item: BaseItemDto) => {
    const name = item.Name ?? '';
    if (item.SeriesName) {
        return `${item.SeriesName} – ${name}`;
    }
    return item.ProductionYear ? `${name} (${item.ProductionYear})` : name;
};

const streamCount = (count: number) => (
    count === 1 ? globalize.translate('StressTestStreamCountOne') : globalize.translate('StressTestStreamCount', count)
);

const STATUS_COLORS = {
    Starting: 'info',
    WarmingUp: 'info',
    KeepingUp: 'success',
    FallingBehind: 'warning',
    LimitReached: 'success',
    MaxStreams: 'success',
    Cancelled: 'default',
    Error: 'error'
} as const;

const statusKey = (stress: TranscodeTestStressResult): keyof typeof STATUS_COLORS => {
    if (stress.Phase !== 'Finished') {
        return stress.Phase;
    }
    switch (stress.EndReason) {
        case 'LimitReached':
        case 'MaxStreams':
        case 'Cancelled':
            return stress.EndReason;
        default:
            return 'Error';
    }
};

const ResultBanner: FC<{ stress: TranscodeTestStressResult, state: TranscodeTestStatus['State'] }> = ({ stress, state }) => {
    const average = stress.AverageOutputMbps != null ? ` ${globalize.translate('StressTestAverageOutput', stress.AverageOutputMbps.toFixed(1))}` : '';
    switch (stress.EndReason) {
        case 'LimitReached':
            return (
                <Alert severity='success'>
                    {globalize.translate('StressTestFinishedLimit', streamCount(stress.MaxStableStreams), streamCount(stress.StreamsAtEnd || stress.PeakStreams), stress.FailedStreamId ?? '', stress.FailedStreamFps != null ? formatFps(stress.FailedStreamFps) : '')}
                    {average}
                </Alert>
            );
        case 'MaxStreams':
            return (
                <Alert severity='success'>
                    {globalize.translate('StressTestFinishedMaxStreams', stress.MaxStreams)}
                    {average}
                </Alert>
            );
        case 'Cancelled':
            return <Alert severity='info'>{globalize.translate('StressTestStopped', streamCount(stress.MaxStableStreams))}</Alert>;
        case 'StreamStalled':
            return <Alert severity='error'>{globalize.translate('StressTestStalled', stress.FailedStreamId ?? '')}</Alert>;
        case 'None':
            return state === 'Running' ? null : <Alert severity='error'>{globalize.translate('TranscodingTestFailed')}</Alert>;
        default:
            return <Alert severity='error'>{globalize.translate('StressTestFailed', stress.Error ?? '')}</Alert>;
    }
};

interface StressTestProps {
    status?: TranscodeTestStatus
    isBusy: boolean
    onStart: (request: TranscodeTestRequest) => void
    onStop: () => void
    onClear: () => void
}

const StressTest: FC<StressTestProps> = ({ status, isBusy, onStart, onStop, onClear }) => {
    const [ item, setItem ] = useState<BaseItemDto | null>(null);
    const [ searchTerm, setSearchTerm ] = useState('');
    const [ targetId, setTargetId ] = useState('1080-h264');
    const [ maxStreams, setMaxStreams ] = useState(16);
    const { data: items, isFetching: isSearching } = useTestMediaSearch(searchTerm);

    // After a reload, show the settings of the last stress test so it can be run again with one click.
    const lastRequest = status?.Kind === 'StressTest' ? status.Request : undefined;
    const lastName = status?.Stress?.Input?.Name;
    const [ isRestored, setIsRestored ] = useState(false);
    useEffect(() => {
        if (isRestored || item || !lastRequest?.ItemId) {
            return;
        }
        setIsRestored(true);
        setItem({ Id: lastRequest.ItemId, Name: lastName ?? '' });
        const last = TARGETS.find(t => t.codec === lastRequest.VideoCodec && t.maxWidth === lastRequest.MaxWidth && t.bitrate === lastRequest.VideoBitrate);
        if (last) {
            setTargetId(last.id);
        }
        if (lastRequest.MaxStreams) {
            setMaxStreams(lastRequest.MaxStreams);
        }
    }, [ isRestored, item, lastRequest, lastName ]);

    const isMine = status?.Kind === 'StressTest';
    const stress = isMine ? status.Stress : undefined;
    // The result is known as soon as the phase is Finished; the server may still be stopping streams.
    const isRunning = isMine && status.State === 'Running' && stress?.Phase !== 'Finished';
    const target = useMemo(() => TARGETS.find(t => t.id === targetId) ?? TARGETS[1], [ targetId ]);

    const onRun = useCallback(() => {
        if (item?.Id) {
            onStart({
                Kind: 'StressTest',
                ItemId: item.Id,
                VideoCodec: target.codec,
                MaxWidth: target.maxWidth,
                VideoBitrate: target.bitrate,
                MaxStreams: maxStreams
            });
        }
    }, [ onStart, item, target, maxStreams ]);

    const onStopClick = useCallback(() => onStop(), [ onStop ]);

    const onClearClick = useCallback(() => onClear(), [ onClear ]);

    const onItemChange = useCallback((_e: React.SyntheticEvent, value: BaseItemDto | null) => {
        setItem(value);
    }, []);

    const onSearchChange = useCallback((_e: React.SyntheticEvent, value: string) => {
        setSearchTerm(value);
    }, []);

    const onTargetChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setTargetId(e.target.value);
    }, []);

    const onMaxStreamsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setMaxStreams(Math.min(64, Math.max(1, parseInt(e.target.value, 10) || 1)));
    }, []);

    const key = stress ? statusKey(stress) : undefined;
    const shownStreams = stress && (stress.Phase === 'Finished' ? stress.MaxStableStreams : stress.RunningStreams);
    const nextIn = stress?.NextStreamInSeconds;

    return (
        <Stack spacing={2}>
            <Typography variant='h2'>{globalize.translate('HeaderStressTest')}</Typography>
            <Typography>{globalize.translate('StressTestHelp', RAMP_SECONDS, SETTLE_SECONDS)}</Typography>
            <Alert severity='warning'>{globalize.translate('StressTestLoadWarning')}</Alert>

            <Autocomplete
                options={items ?? []}
                value={item}
                onChange={onItemChange}
                onInputChange={onSearchChange}
                getOptionLabel={formatItem}
                isOptionEqualToValue={(a, b) => a.Id === b.Id}
                filterOptions={x => x}
                loading={isSearching}
                disabled={isBusy}
                renderInput={params => (
                    <TextField
                        {...params}
                        label={globalize.translate('LabelStressTestMedia')}
                        helperText={globalize.translate('LabelStressTestMediaHelp')}
                    />
                )}
            />
            <Stack direction='row' spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <TextField
                    select
                    label={globalize.translate('LabelTranscodingTestTarget')}
                    value={targetId}
                    onChange={onTargetChange}
                    disabled={isBusy}
                    sx={{ width: 240 }}
                >
                    {TARGETS.map(t => (
                        <MenuItem key={t.id} value={t.id}>{t.label}</MenuItem>
                    ))}
                </TextField>
                <TextField
                    type='number'
                    label={globalize.translate('LabelTranscodingTestMaxStreams')}
                    value={maxStreams}
                    onChange={onMaxStreamsChange}
                    disabled={isBusy}
                    sx={{ width: 160 }}
                    slotProps={{ htmlInput: { min: 1, max: 64, step: 1 } }}
                />
            </Stack>
            <Stack direction='row' spacing={2}>
                <Button size='large' onClick={onRun} disabled={isBusy || !item}>
                    {globalize.translate('ButtonStartStressTest')}
                </Button>
                {isRunning && (
                    <Button size='large' color='error' variant='outlined' onClick={onStopClick}>
                        {globalize.translate('ButtonStopTest')}
                    </Button>
                )}
                {isMine && !isBusy && (
                    <Button size='large' variant='text' onClick={onClearClick}>
                        {globalize.translate('ButtonClearTestResults')}
                    </Button>
                )}
            </Stack>

            {stress && status && <ResultBanner stress={stress} state={status.State} />}
            {stress?.ShortSource && <Alert severity='warning'>{globalize.translate('StressTestShortSource')}</Alert>}

            {stress && key && (
                <Paper variant='outlined' sx={{ p: 2 }}>
                    <Stack spacing={2}>
                        <Stack direction='row' spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                            <Typography variant='h2' component='p'>{streamCount(shownStreams ?? 0)}</Typography>
                            <Chip color={STATUS_COLORS[key]} label={globalize.translate(`StressTestStatus${key}`)} />
                        </Stack>

                        {stress.Phase === 'KeepingUp' && nextIn != null && (
                            <Box>
                                <LinearProgress variant='determinate' value={Math.min(100, 100 * (1 - nextIn / stress.RampSeconds))} />
                                <Typography variant='body2' color='text.secondary' sx={{ mt: 0.5 }}>
                                    {globalize.translate('StressTestNextStream', Math.ceil(nextIn))}
                                </Typography>
                            </Box>
                        )}
                        {stress.Phase === 'FallingBehind' && stress.EndsInSeconds != null && (
                            <Box>
                                <LinearProgress
                                    color='warning'
                                    variant='determinate'
                                    value={Math.min(100, 100 * (1 - stress.EndsInSeconds / stress.FailSeconds))}
                                />
                                <Typography variant='body2' color='warning.main' sx={{ mt: 0.5 }}>
                                    {globalize.translate(
                                        'StressTestFallingBehind',
                                        stress.BehindStreamId ?? '',
                                        formatFps(stress.ThresholdFps),
                                        Math.ceil(stress.EndsInSeconds)
                                    )}
                                </Typography>
                            </Box>
                        )}
                        {(stress.Phase === 'WarmingUp' || stress.Phase === 'Starting') && (
                            <Box>
                                <LinearProgress color='warning' />
                                <Typography variant='body2' color='text.secondary' sx={{ mt: 0.5 }}>
                                    {globalize.translate('StressTestWarmingUp')}
                                </Typography>
                            </Box>
                        )}

                        {isRunning && stress.ThresholdFps > 0 && (
                            <Typography>{stressRunningHelp(stress)}</Typography>
                        )}

                        <Box component='dl' sx={{ m: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 2, rowGap: 0.5 }}>
                            {stress.Input && (
                                <>
                                    <Typography component='dt' color='text.secondary'>{globalize.translate('LabelStressTestInput')}</Typography>
                                    <Typography component='dd' sx={{ m: 0 }}>{describeInput(stress.Input)}</Typography>
                                </>
                            )}
                            {stress.Output && (
                                <>
                                    <Typography component='dt' color='text.secondary'>{globalize.translate('LabelStressTestOutput')}</Typography>
                                    <Typography component='dd' sx={{ m: 0 }}>
                                        {describeOutput(stress.Output)}
                                        <Typography component='span' color='text.secondary' sx={{ display: 'block' }}>
                                            {describePipeline(stress.Output)} · {stress.Output.Encoder}
                                        </Typography>
                                    </Typography>
                                </>
                            )}
                        </Box>

                        {stress.Streams.length > 0 && (
                            <Table size='small'>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>{globalize.translate('HeaderStressTestStream')}</TableCell>
                                        <TableCell align='right'>{isRunning ? 'fps' : globalize.translate('HeaderStressTestFinalFps')}</TableCell>
                                        <TableCell align='right'>{globalize.translate('HeaderStressTestOutputMbps')}</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {stress.Streams.map(s => {
                                        const fps = isRunning ? s.Fps : s.FinalFps;
                                        const behind = fps != null && fps < stress.ThresholdFps;
                                        return (
                                            <TableRow key={s.Id}>
                                                <TableCell>{s.Id}</TableCell>
                                                <TableCell align='right' sx={behind ? { color: 'error.main' } : undefined}>
                                                    {fps != null ? formatFps(fps) : '—'}
                                                </TableCell>
                                                <TableCell align='right'>{s.OutputMbps != null ? s.OutputMbps.toFixed(1) : '—'}</TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        )}
                    </Stack>
                </Paper>
            )}

            {isMine && <TestConsole log={status.Log} />}
        </Stack>
    );
};

export default StressTest;
