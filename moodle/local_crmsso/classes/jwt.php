<?php
namespace local_crmsso;

defined('MOODLE_INTERNAL') || die();

/**
 * Minimal, dependency-free HS256 JWT verifier. Matches what the CRM signs
 * with `jsonwebtoken` in backend/src/services/lms/ssoToken.js:
 *   header  { alg: "HS256", typ: "JWT" }
 *   claims  { iss, aud, sub, jti, eml, name, role, wantsurl, iat, exp }
 */
class jwt {

    /**
     * @param string $token
     * @param string $secret
     * @param string $issuer   expected iss
     * @param string $audience expected aud
     * @param int    $leeway   clock-skew allowance, seconds
     * @return array decoded claims
     * @throws \moodle_exception on any validation failure
     */
    public static function verify(string $token, string $secret, string $issuer, string $audience, int $leeway = 10): array {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new \moodle_exception('badtoken', 'local_crmsso', '', 'malformed');
        }
        [$h64, $p64, $s64] = $parts;

        $header = json_decode(self::b64url_decode($h64), true);
        $claims = json_decode(self::b64url_decode($p64), true);
        $sig = self::b64url_decode($s64);

        if (!is_array($header) || ($header['alg'] ?? '') !== 'HS256') {
            throw new \moodle_exception('badtoken', 'local_crmsso', '', 'alg');
        }
        $expected = hash_hmac('sha256', $h64 . '.' . $p64, $secret, true);
        if (!hash_equals($expected, $sig)) {
            throw new \moodle_exception('badtoken', 'local_crmsso', '', 'signature');
        }
        if (!is_array($claims)) {
            throw new \moodle_exception('badtoken', 'local_crmsso', '', 'claims');
        }

        $now = time();
        if (isset($claims['exp']) && $now > ((int) $claims['exp'] + $leeway)) {
            throw new \moodle_exception('badtoken', 'local_crmsso', '', 'expired');
        }
        if (isset($claims['nbf']) && $now < ((int) $claims['nbf'] - $leeway)) {
            throw new \moodle_exception('badtoken', 'local_crmsso', '', 'notyet');
        }
        if ($issuer !== '' && ($claims['iss'] ?? '') !== $issuer) {
            throw new \moodle_exception('badtoken', 'local_crmsso', '', 'issuer');
        }
        if ($audience !== '' && ($claims['aud'] ?? '') !== $audience) {
            throw new \moodle_exception('badtoken', 'local_crmsso', '', 'audience');
        }
        if (empty($claims['sub']) || empty($claims['jti'])) {
            throw new \moodle_exception('badtoken', 'local_crmsso', '', 'sub/jti');
        }
        return $claims;
    }

    private static function b64url_decode(string $s): string {
        $s = strtr($s, '-_', '+/');
        $pad = strlen($s) % 4;
        if ($pad) {
            $s .= str_repeat('=', 4 - $pad);
        }
        return base64_decode($s, true) ?: '';
    }
}
