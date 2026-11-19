# Checkout performance inputs

This directory contains the current checkout service requirements, observed traffic shape, service measurements, commercial rates, and recovery targets. The checkout path is gateway, authentication, pricing, inventory, and payment. Treat the dated values in the current-environment documents as authoritative when an older example appears elsewhere.

The proposed architecture must fit the production checkout workload. A decision document should compare the available changes rather than silently assuming that every hop can run at the same time.

The files are deliberately kept close to the way an architecture review receives them: prose owns the context, while the small JSON and CSV files preserve the values used for calculations.