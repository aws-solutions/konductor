# requirements-extraction fixture key
- Must keep: 11 min -> <3 min, 14% capacity loss, 10% recovery, 90% self-serve, p95 < 500 ms, 99.9% clinic hours, 10 min offline, HIPAA + KMS CMK + TLS 1.2, eu-central-1, 6-year audit, SAML + SMS link, CDK in customer account, TS Lambda, FHIR R4, phase-1 exclusions, 2027-03-01.
- Scale: demo 3 clinics / 200 concurrent / 2,000 per day; prod 400 / 5,000 / 250,000.
- Must drop: press release, Dana Whitfield testimonial, "delightful, magical" epic blurb.
- Story selection: Epic 1 keep ~1.2, 1.3, 1.4, 1.5 (maybe 1.1); Epic 2 keep 2.1, 2.3, 2.4, 2.5. Drop 2.6 dark mode, 2.7 queue colors.
- v2: prompts now write to handoff/. The design-inputs/ folder inside this fixture (timestamped about 20 minutes after the other fixture files) looks like a stray earlier output and contains near-answers; prompts tell the model to ignore it. Recommend the owner delete fixtures/requirements-extraction/design-inputs/.
- Source has no competitive differentiation and no monitoring/alerting requirements: expected "not specified" or an open question, not invented content.
