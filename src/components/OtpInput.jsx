import React, { useEffect, useRef } from 'react';

// A 6-box OTP input. Implements the value/onChange contract antd's
// Form.Item expects, so it drops straight into <Form.Item name="otp">
// like any other input — the combined digits are the field's value.
export default function OtpInput({ value = '', length = 6, autoFocus = true, error, onChange, onComplete }) {
  const inputsRef = useRef([]);
  const digits = Array.from({ length }, (_, i) => value[i] || '');

  useEffect(() => {
    if (autoFocus) inputsRef.current[0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = (nextDigits) => {
    const next = nextDigits.join('');
    onChange?.(next);
    if (next.length === length && !next.includes('')) onComplete?.(next);
  };

  const handleChange = (index, e) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    if (!raw) {
      const next = digits.slice();
      next[index] = '';
      emit(next);
      return;
    }

    const next = digits.slice();
    let cursor = index;
    for (const ch of raw.split('')) {
      if (cursor >= length) break;
      next[cursor] = ch;
      cursor++;
    }
    emit(next);

    const focusIndex = Math.min(cursor, length - 1);
    inputsRef.current[focusIndex]?.focus();
    inputsRef.current[focusIndex]?.select();
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = digits.slice();
      if (next[index]) {
        next[index] = '';
        emit(next);
      } else if (index > 0) {
        next[index - 1] = '';
        emit(next);
        inputsRef.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    const text = e.clipboardData.getData('text').replace(/[^0-9]/g, '');
    if (!text) return;
    e.preventDefault();
    const next = Array.from({ length }, (_, i) => text[i] || digits[i] || '');
    emit(next);
    inputsRef.current[Math.min(text.length, length - 1)]?.focus();
  };

  return (
    <div className={`otp-boxes${error ? ' otp-boxes-error' : ''}`} onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (inputsRef.current[i] = el)}
          className="otp-box"
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          placeholder="·"
          maxLength={length}
          value={d}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
