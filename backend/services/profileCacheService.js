const redisClient = require('../utils/redisClient');
const User = require('../models/User');

class ProfileCacheService {
  static CACHE_PREFIX = 'user_profile:';
  static DEFAULT_TTL = 300; // 5분

  // 캐시 키 생성
  static getCacheKey(userId) {
    return `${this.CACHE_PREFIX}${userId}`;
  }

  // 프로필 포맷팅
  static formatProfile(user) {
    if (!user) return null;
    
    return {
      id: user._id || user.id,
      name: user.name,
      email: user.email,
      profileImage: user.profileImage || '',
      lastActive: user.lastActive,
      createdAt: user.createdAt
    };
  }

  // 단일 프로필 캐시 조회
  static async getProfile(userId, options = {}) {
    const { ttl = this.DEFAULT_TTL } = options;
    
    try {
      if (!userId) {
        throw new Error('User ID is required');
      }

      const cacheKey = this.getCacheKey(userId);

      // 캐시에서 조회
      try {
        const cachedProfile = await redisClient.get(cacheKey);
        if (cachedProfile) {
          console.log(`프로필 캐시 hit : ${userId}`);
          return {
            profile: typeof cachedProfile === 'string' ? JSON.parse(cachedProfile) : cachedProfile,
            fromCache: true
          };
        }
      } catch (cacheError) {
        console.error('Cache read error:', cacheError);
      }

      console.log(`프로필 캐시 miss : ${userId}`);

      // DB에서 조회
      const user = await User.findById(userId).select('-password').lean();
      if (!user) {
        return { profile: null, fromCache: false };
      }

      const formattedProfile = this.formatProfile(user);

      // 캐시에 저장
      try {
        await redisClient.setEx(cacheKey, ttl, JSON.stringify(formattedProfile));
        console.log(`💾 Profile cached: ${userId}, TTL: ${ttl}s`);
      } catch (cacheError) {
        console.error('Cache write error:', cacheError);
      }

      return { profile: formattedProfile, fromCache: false };

    } catch (error) {
      console.error('Profile cache service error:', error);
      throw error;
    }
  }

  // 프로필 캐시 업데이트
  static async updateProfile(userId, profileData, options = {}) {
    const { ttl = this.DEFAULT_TTL } = options;
    
    try {
      if (!userId || !profileData) {
        throw new Error('User ID and profile data are required');
      }

      const cacheKey = this.getCacheKey(userId);
      const formattedProfile = this.formatProfile(profileData);

      // 캐시 업데이트
      await redisClient.setEx(cacheKey, ttl, JSON.stringify(formattedProfile));
      console.log(`프로필 캐시 update : ${userId}`);
      
      return formattedProfile;

    } catch (error) {
      console.error('Profile cache update error:', error);
      throw error;
    }
  }

  // 프로필 캐시 무효화
  static async invalidateProfile(userId) {
    try {
      if (!userId) {
        throw new Error('User ID is required');
      }

      const cacheKey = this.getCacheKey(userId);
      const deleted = await redisClient.del(cacheKey);

      if (deleted > 0) {
        console.log(`프로필 캐시 무효화 : ${userId}`);
      }

      return deleted > 0;

    } catch (error) {
      console.error('Profile cache invalidation error:', error);
      return false;
    }
  }
}

module.exports = ProfileCacheService;