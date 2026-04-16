const express = require('express');
const router = express.Router();

router.use('/portfolio', require('./portfolio'));
router.use('/roles', require('./roles'));
router.use('/candidates', require('./candidates'));
router.use('/matches', require('./matches'));
router.use('/criteria', require('./criteria'));
router.use('/sourcing', require('./sourcing'));
router.use('/trash', require('./trash'));

module.exports = router;
