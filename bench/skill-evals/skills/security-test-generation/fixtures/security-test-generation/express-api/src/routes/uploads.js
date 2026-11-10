const router = require('express').Router();
const multer = require('multer');
const upload = multer({ dest: 'public/uploads/' });

router.post('/', upload.single('file'), (req, res) => {
  res.json({ url: '/uploads/' + req.file.originalname });
});

module.exports = router;
