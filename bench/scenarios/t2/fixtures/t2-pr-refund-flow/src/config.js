import defaults from '../config/default.json' with { type: 'json' };

export const config = Object.freeze({
  ...defaults,
  port: Number(process.env.PORT || defaults.port)
});
