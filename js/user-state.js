/**
 * User state module — centralized subscription/feature state.
 */

let _user = null;

export function setUser(user) {
    _user = user;
}

export function getUser() {
    return _user;
}

export function isFreeUser() {
    if (!_user) return true;
    return !_user.subscription_tier || _user.subscription_tier === 'free';
}

export function hasFeature(name) {
    if (!_user) return false;
    if (!_user.features) return false;
    return !!_user.features[name];
}
