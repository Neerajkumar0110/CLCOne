const Joi = require('joi');
const schema = Joi.object({
  client: Joi.alternatives().try(Joi.string(), Joi.object()).required(),
  number: Joi.number().required(),
  year: Joi.number().required(),
  status: Joi.string().required(),
  notes: Joi.string().allow(''),
  expiredDate: Joi.date().required(),
  date: Joi.date().required(),
  // array cannot be empty
  items: Joi.array()
    .items(
      Joi.object({
        _id: Joi.string().allow('').optional(),
        itemName: Joi.string().required(),
        description: Joi.string().allow(''),
        quantity: Joi.number().required(),
        price: Joi.number().required(),
        total: Joi.number().required(),
      }).required()
    )
    .required(),
  taxRate: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
  // Allowed on create so a new invoice can be issued in a currency other
  // than the model's 'NA' default; update.js already strips it back out on
  // edits (an invoice's currency doesn't change once issued), so this only
  // ever takes effect at creation time.
  currency: Joi.string().optional(),
  discount: Joi.number().optional(),
  approved: Joi.boolean().optional(),
});

module.exports = schema;
