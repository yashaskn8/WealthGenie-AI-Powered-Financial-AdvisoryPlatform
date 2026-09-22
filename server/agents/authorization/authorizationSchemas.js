import Joi from 'joi';

const mandateId = Joi.string().guid({ version: ['uuidv4'] }).required();

export const mandateApprovalAssertionSchema = Joi.object({
  method: Joi.string().valid('DEVELOPMENT', 'WEBAUTHN').required(),
  mandateId,
  mandateHash: Joi.string().pattern(/^[a-f0-9]{64}$/).required(),
  credentialId: Joi.string().max(512).allow(null),
  response: Joi.object().unknown(true).max(30).allow(null),
}).unknown(false);

export const mandateRevokeSchema = Joi.object({
  reason: Joi.string().trim().min(1).max(240).default('User revoked authorization.'),
}).unknown(false);

export const mandateIdParamSchema = Joi.object({ mandateId }).unknown(false);

export const passkeyRegistrationResponseSchema = Joi.object({
  id: Joi.string().max(512).required(),
  rawId: Joi.string().max(1024).required(),
  type: Joi.string().valid('public-key').required(),
  response: Joi.object().unknown(true).max(30).required(),
  clientExtensionResults: Joi.object().unknown(true).max(30).required(),
}).unknown(false);
