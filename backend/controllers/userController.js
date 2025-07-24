const bcrypt = require('bcryptjs');
const User = require('../models/User');
const {DeleteObjectCommand}=require('@aws-sdk/client-s3');
const s3= require('../utils/s3Client');
const ProfileCacheService = require('../services/profileCacheService');

// 회원가입
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // 입력값 검증
    const validationErrors = [];
    
    if (!name || name.trim().length === 0) {
      validationErrors.push({
        field: 'name',
        message: '이름을 입력해주세요.'
      });
    } else if (name.length < 2) {
      validationErrors.push({
        field: 'name',
        message: '이름은 2자 이상이어야 합니다.'
      });
    }

    if (!email) {
      validationErrors.push({
        field: 'email',
        message: '이메일을 입력해주세요.'
      });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      validationErrors.push({
        field: 'email',
        message: '올바른 이메일 형식이 아닙니다.'
      });
    }

    if (!password) {
      validationErrors.push({
        field: 'password',
        message: '비밀번호를 입력해주세요.'
      });
    } else if (password.length < 6) {
      validationErrors.push({
        field: 'password',
        message: '비밀번호는 6자 이상이어야 합니다.'
      });
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        errors: validationErrors
      });
    }

    // 사용자 중복 확인
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: '이미 가입된 이메일입니다.'
      });
    }

    // 비밀번호 암호화 및 사용자 생성
    const newUser = new User({ 
      name, 
      email, 
      password,
      profileImage: '' // 기본 프로필 이미지 없음
    });

    const salt = await bcrypt.genSalt(10);
    newUser.password = await bcrypt.hash(password, salt);
    await newUser.save();

    res.status(201).json({
      success: true,
      message: '회원가입이 완료되었습니다.',
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        profileImage: newUser.profileImage
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: '회원가입 처리 중 오류가 발생했습니다.'
    });
  }
};

// 프로필 조회 (ProfileCacheService 사용)
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    // ProfileCacheService를 통한 캐시 조회
    const { profile, fromCache } = await ProfileCacheService.getProfile(userId);
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      user: profile,
      cached: fromCache // 디버깅용 플래그
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: '프로필 조회 중 오류가 발생했습니다.'
    });
  }
};

// 프로필 업데이트 (ProfileCacheService 사용)
exports.updateProfile = async (req, res) => {
  try {
    const { name } = req.body;
    const userId = req.user.id;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: '이름을 입력해주세요.'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    user.name = name.trim();
    await user.save();

    // ProfileCacheService를 통한 캐시 업데이트
    const updatedProfile = await ProfileCacheService.updateProfile(userId, user);

    res.json({
      success: true,
      message: '프로필이 업데이트되었습니다.',
      user: updatedProfile
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: '프로필 업데이트 중 오류가 발생했습니다.'
    });
  }
};

// 비밀번호 변경
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // 입력값 검증
    const validationErrors = [];

    if (!currentPassword) {
      validationErrors.push({
        field: 'currentPassword',
        message: '현재 비밀번호를 입력해주세요.'
      });
    }

    if (!newPassword) {
      validationErrors.push({
        field: 'newPassword',
        message: '새 비밀번호를 입력해주세요.'
      });
    } else if (newPassword.length < 6) {
      validationErrors.push({
        field: 'newPassword',
        message: '새 비밀번호는 6자 이상이어야 합니다.'
      });
    }

    if (!confirmPassword) {
      validationErrors.push({
        field: 'confirmPassword',
        message: '새 비밀번호 확인을 입력해주세요.'
      });
    }

    if (newPassword && confirmPassword && newPassword !== confirmPassword) {
      validationErrors.push({
        field: 'confirmPassword',
        message: '새 비밀번호가 일치하지 않습니다.'
      });
    }

    if (currentPassword && newPassword && currentPassword === newPassword) {
      validationErrors.push({
        field: 'newPassword',
        message: '새 비밀번호는 현재 비밀번호와 달라야 합니다.'
      });
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        errors: validationErrors
      });
    }

    // 사용자 조회
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    // 현재 비밀번호 확인
    const isCurrentPasswordValid = await user.matchPassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: '현재 비밀번호가 올바르지 않습니다.',
        errors: [{
          field: 'currentPassword',
          message: '현재 비밀번호가 올바르지 않습니다.'
        }]
      });
    }

    // 새 비밀번호로 변경
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: '비밀번호가 성공적으로 변경되었습니다.'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: '비밀번호 변경 중 오류가 발생했습니다.'
    });
  }
};

// 프로필 이미지 업로드 (ProfileCacheService 사용)
exports.uploadProfileImage = async (req, res) => {
  try {
    const { profileImage} = req.body;
    const userId = req.user.id;

    if (!profileImage) {
      return res.status(400).json({
        success: false,
        message: '이미지 URL 또는 파일 키가 누락되었습니다.'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
    }

    // 기존 이미지 삭제
    if (user.profileImage) {
      const key = user.profileImage.replace(/^.*\/uploads\//, 'uploads/');
      try {
        await s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: key
        }));
      } catch (err) {
        console.warn('기존 프로필 이미지 삭제 실패:', err.message);
      }
    }

    user.profileImage = "https://"+process.env.AWS_BUCKET_NAME+".s3.ap-northeast-2.amazonaws.com/"+profileImage;
    await user.save();

    // ProfileCacheService를 통한 캐시 업데이트
    await ProfileCacheService.updateProfile(userId, user);

    res.json({
      success: true,
      message: '프로필 이미지가 저장되었습니다.',
      profileImage
    });

  } catch (error) {
    console.error('setProfileImage error:', error);
    res.status(500).json({ success: false, message: '프로필 이미지 저장 중 오류가 발생했습니다.' });
  }
};

// 프로필 이미지 삭제 (ProfileCacheService 사용)
exports.deleteProfileImage = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });

    if (user.profileImage) {
      const key = user.profileImage.replace(/^.*\/uploads\//, 'uploads/');

      try {
        await s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: key
        }));
      } catch (error) {
        console.error('Profile image delete error:', error);
      }

      user.profileImage = '';
      await user.save();

      // ProfileCacheService를 통한 캐시 업데이트
      await ProfileCacheService.updateProfile(userId, user);
    }

    res.json({ success: true, message: '프로필 이미지가 삭제되었습니다.' });

  } catch (error) {
    console.error('Delete profile image error:', error);
    res.status(500).json({ success: false, message: '프로필 이미지 삭제 중 오류가 발생했습니다.' });
  }
};

// 회원 탈퇴 (ProfileCacheService 사용)
exports.deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });

    if (user.profileImage) {
      const key = user.profileImage.replace(/^.*\/uploads\//, 'uploads/');
      try {
        await s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: key
        }));
      } catch (error) {
        console.error('Profile image delete error:', error);
      }
    }

    await user.deleteOne();

    // ProfileCacheService를 통한 캐시 무효화
    await ProfileCacheService.invalidateProfile(userId);

    res.json({ success: true, message: '회원 탈퇴가 완료되었습니다.' });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ success: false, message: '회원 탈퇴 처리 중 오류가 발생했습니다.' });
  }
};

module.exports = exports;