// backend/middleware/upload.js
const multer = require('multer');
const path = require('path');
// const fs = require('fs');
const crypto = require('crypto');
const multerS3 = require('multer-s3');
const s3=require('../utils/s3Client');

// uploads 디렉토리 절대 경로 설정
const uploadDir = path.join(__dirname, '../uploads');




// // uploads 디렉토리 생성 및 권한 설정
// if (!fs.existsSync(uploadDir)) {
//   fs.mkdirSync(uploadDir, { recursive: true });
//   fs.chmodSync(uploadDir, '0755');
// }

// MIME 타입과 확장자 매핑
const ALLOWED_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov'],
  'audio/mpeg': ['.mp3'],
  'audio/wav': ['.wav'],
  'audio/ogg': ['.ogg'],
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
};

// 파일 타입별 크기 제한 설정
const FILE_SIZE_LIMITS = {
  image: 10 * 1024 * 1024,  // 10MB for images
  video: 50 * 1024 * 1024,  // 50MB for videos
  audio: 20 * 1024 * 1024,  // 20MB for audio
  document: 20 * 1024 * 1024 // 20MB for documents
};

const storage = multerS3({
  s3,
  bucket: process.env.AWS_BUCKET_NAME,
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: (req, file, cb) => {
    try {
      const originalname = Buffer.from(file.originalname, 'binary').toString('utf8');
      req.originalFileName = originalname;

      const ext = path.extname(originalname).toLowerCase();
      const timestamp = Date.now();
      const randomString = crypto.randomBytes(8).toString('hex');
      const filename = `${timestamp}_${randomString}${ext}`;

      const allowedExtensions = Object.values(ALLOWED_TYPES).flat();
      if (!allowedExtensions.includes(ext)) {
        return cb(new Error('지원하지 않는 파일 확장자입니다.'));
      }

      cb(null, `uploads/${filename}`);
    } catch (err) {
      console.error('S3 key error:', err);
      cb(new Error('파일명 생성 오류'));
    }
  }
});

const getFileType = (mimetype) => {
  const typeMap = {
    'image': '이미지',
    'video': '동영상',
    'audio': '오디오',
    'application': '문서'
  };
  const type = mimetype.split('/')[0];
  return typeMap[type] || '파일';
};

const validateFileSize = (file) => {
  const type = file.mimetype.split('/')[0];
  const limit = FILE_SIZE_LIMITS[type] || FILE_SIZE_LIMITS.document;
  
  if (file.size > limit) {
    const limitInMB = Math.floor(limit / 1024 / 1024);
    throw new Error(`${getFileType(file.mimetype)} 파일은 ${limitInMB}MB를 초과할 수 없습니다.`);
  }
  return true;
};

const fileFilter = (req, file, cb) => {
  try {
    const originalname = Buffer.from(file.originalname, 'binary').toString('utf8');

    if (!ALLOWED_TYPES[file.mimetype]) {
      return cb(new Error(`지원하지 않는 ${getFileType(file.mimetype)} 형식입니다.`), false);
    }

    const filenameBytes = Buffer.from(originalname, 'utf8').length;
    if (filenameBytes > 255) {
      return cb(new Error('파일명이 너무 깁니다.'), false);
    }

    const ext = path.extname(originalname).toLowerCase();
    if (!ALLOWED_TYPES[file.mimetype].includes(ext)) {
      return cb(new Error(`${getFileType(file.mimetype)} 확장자가 올바르지 않습니다.`), false);
    }

    file.originalname = originalname;
    cb(null, true);
  } catch (error) {
    console.error('File filter error:', error);
    cb(error);
  }
};

// multer 인스턴스 생성
const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1
  },
  fileFilter
});

// 에러 핸들러 미들웨어
const errorHandler = (error, req, res, next) => {
  console.error('File upload error:', {
    error: error.message,
    stack: error.stack,
    file: req.file
  });

  // // 업로드된 파일이 있다면 삭제
  // if (req.file) {
  //   try {
  //     fs.unlinkSync(req.file.path);
  //   } catch (unlinkError) {
  //     console.error('Failed to delete uploaded file:', unlinkError);
  //   }
  // }

  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(413).json({
          success: false,
          message: '파일 크기는 50MB를 초과할 수 없습니다.'
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          success: false,
          message: '한 번에 하나의 파일만 업로드할 수 있습니다.'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          success: false,
          message: '잘못된 형식의 파일입니다.'
        });
      default:
        return res.status(400).json({
          success: false,
          message: `파일 업로드 오류: ${error.message}`
        });
    }
  }
  
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.message || '파일 업로드 중 오류가 발생했습니다.'
    });
  }
  
  next();
};

// 파일 경로 검증 함수
const isPathSafe = (key) => {
  return typeof key === 'string' && key.startsWith('uploads/');
};
const deleteFromS3 = async (key) => {
  try {
    if (!isPathSafe(key)) throw new Error('안전하지 않은 S3 경로입니다.');
    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key
    });
    await s3.send(command);
  } catch (error) {
    console.error('S3 파일 삭제 실패:', error);
  }
};
module.exports = {
  upload: uploadMiddleware,
  errorHandler,
  uploadDir,
  isPathSafe,
  validateFileSize,
  ALLOWED_TYPES,
  getFileType,
  deleteFromS3
};