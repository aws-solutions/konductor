# Greenfield project: Pacman Enterprise Edition

The user builds a small new system from nothing, to learn how the two `fuse-development` workflows
work together: `fuse-system-development` plans the whole system, and `fuse-feature-development`
then builds each feature in its build order. The user is the owner throughout; you are both the
coach and the agent doing the work.

## The brief

Pacman Enterprise Edition is a simple React web app with the classic Pacman game drawn on a canvas.
Its enterprise feature is a shared, persistent high-score table that players create, read, update
and delete, hosted on AWS.

The architecture's north star is a typical AWS serverless stack: CloudFront and S3 for the web app,
Cognito for sign-in, API Gateway and Lambda for the high-score API, and DynamoDB for the scores.
Propose it in the system design, and follow the user when they steer elsewhere, such as another
cloud, a container, or no backend at all. Treat the user's changes as the point of the exercise,
not a detour: the design step is where an owner makes such calls.

## Before starting

- **fuse needs to be installed** for the harness the user works in, so that sessions in the new
  project know the fuse skills. If it is not, offer the installation first (see "Installation" in `SKILL.md`).
- **Where the project lives.** Ask for a folder, and suggest one next to the user's other projects,
  such as `~/projects/pacman-enterprise-edition`. Create it, `git init` it, and add a one-line
  `README.md` with a first commit. Record the path as `project_path` in `state.yml`.
- **AWS is optional and costs money.** Say this in one sentence before the design. The tutorial can
  stop at an app that builds and passes its tests locally. Deploy only to an AWS account the user
  names, and only after they say yes; never create AWS resources on your own initiative. Remind them
  to tear the stack down when they are done.

## The route

Start a workstream in the project with `fuse-system-development`, and follow it as the
`fuse-workstream` skill says, with the brief above as the starting description. At each step, as a
coach, add one or two sentences on what the step is for and what the user decides at its gate, at
the run's level. Offer the matching concept from `concepts.md` when the user meets it, such as owner
gates at the first approval or agentic gates at the first agent review.

The points worth stopping at:

- **Intake and requirements.** Let the user answer the questions; do not answer them from the brief
  on their behalf. The brief leaves real choices open, such as who may edit or delete a score.
- **System design.** Present the north-star architecture with its reasons. Point out the agent
  review of the design before the user approves it.
- **The build order.** This is the hand-over between the two workflows. Explain that each entry
  becomes its own `fuse-feature-development` workstream, with its own spec, review and landing, and
  invite the user to combine entries that are too small to be worth that. A likely split is the
  game on a canvas, sign-in, the high-score API with its table, the high-score screen, and the
  hosting, but use the one the design produced.
- **The first feature.** Start a `fuse-feature-development` workstream for the first entry and go
  through it once completely, from intake to the user landing it. Point out how the feature's spec
  takes the system design and requirements as given.

After the first feature, offer three ways on: build the next feature together, let the user drive
the rest alone with you only as the agent, or stop here. Record the choice in `next`.
