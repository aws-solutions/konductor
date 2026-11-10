export const PROJECT_NAME_MIN = 3;
export const PROJECT_NAME_MAX = 64;

export const VALIDATION_MESSAGES = {
  projectNameRequired: 'Project name is required.',
  projectNameLength: `Project name must be ${PROJECT_NAME_MIN} to ${PROJECT_NAME_MAX} characters.`,
  regionRequired: 'Select a region.',
  termsRequired: 'You must accept the terms.',
  endBeforeStart: 'End date must be after the start date.',
};
