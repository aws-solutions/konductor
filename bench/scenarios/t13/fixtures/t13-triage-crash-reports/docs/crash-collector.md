# Crash collector fields

Each JSON envelope has an `id`, UTC `timestamp`, `appVersion`, `os`, `osVersion`, `userHash`, `topFrames`, and `lastLogs`. The user hash is stable for counting distinct users within this export. A report count counts envelopes, not frames.

The collector retains the first eight symbolized frames and the last five log lines. Platform symbols can use different names for equivalent functions. The Windows build may inline small functions, so one crash can show two closely related top frames. Group by the underlying behavior when the evidence supports it.

Do not treat a repeated log phrase as a crash signature without checking the frames and release comparison.
