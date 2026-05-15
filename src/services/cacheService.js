import NodeCache from 'node-cache';

class CacheService {
  constructor(ttlSeconds = 300) { // 5 minutes default TTL
    this.cache = new NodeCache({
      stdTTL: ttlSeconds,
      checkperiod: ttlSeconds * 0.2,
      useClones: false
    });
  }

  get(key) {
    return this.cache.get(key);
  }

  set(key, value, ttl = undefined) {
    return this.cache.set(key, value, ttl);
  }

  del(key) {
    return this.cache.del(key);
  }

  flush() {
    return this.cache.flushAll();
  }

  // Generate cache keys
  getUserPermissionsKey(userId) {
    return `user_perms:${userId}`;
  }

  getAccessiblePropertiesKey(userId, userRole) {
    return `accessible_props:${userId}:${userRole}`;
  }

  getPropertyAccessKey(userId, propertyId) {
    return `prop_access:${userId}:${propertyId}`;
  }

  // Invalidate all caches for a specific user
  invalidateUser(userId) {
    if (!userId) return;
    
    // Delete exact matches
    this.cache.del(this.getUserPermissionsKey(userId));
    
    // Delete all accessible properties keys for this user (any role)
    const allKeys = this.cache.keys();
    const accessiblePropsPattern = `accessible_props:${userId}:`;
    const propertyAccessPattern = `prop_access:${userId}:`;
    
    const keysToDelete = allKeys.filter(key => 
      key.startsWith(accessiblePropsPattern) || 
      key.startsWith(propertyAccessPattern)
    );
    
    keysToDelete.forEach(key => this.cache.del(key));
    
    console.log(`Cache invalidated for user ${userId}: ${keysToDelete.length + 1} keys removed`);
  }

  // Invalidate multiple users at once
  invalidateUsers(userIds) {
    const uniqueUserIds = [...new Set(userIds.filter(id => id))];
    uniqueUserIds.forEach(userId => this.invalidateUser(userId));
  }

  // Invalidate property access for all users (when property permissions change)
  invalidatePropertyAccess(propertyId) {
    const allKeys = this.cache.keys();
    const propertyAccessPattern = `prop_access:`;
    
    const keysToDelete = allKeys.filter(key => 
      key.startsWith(propertyAccessPattern) && key.includes(`:${propertyId}`)
    );
    
    keysToDelete.forEach(key => this.cache.del(key));
    console.log(`Cache invalidated for property ${propertyId}: ${keysToDelete.length} keys removed`);
  }

  // Get cache stats for monitoring
  getStats() {
    return {
      keys: this.cache.keys().length,
      hits: this.cache.getStats().hits,
      misses: this.cache.getStats().misses,
      ksize: this.cache.getStats().ksize,
      vsize: this.cache.getStats().vsize
    };
  }
}

export default new CacheService();