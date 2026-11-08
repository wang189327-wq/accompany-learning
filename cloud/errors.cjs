'use strict';
const codes = {
  400: 'INVALID_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  503: 'SERVICE_UNAVAILABLE',
};
class AppError extends Error {
  constructor(status, message, code = codes[status] || 'INTERNAL_ERROR') {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}
function validate(operation) {
  try {
    return operation();
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, e.message, 'VALIDATION_ERROR');
  }
}
function responseError(error) {
  if (error instanceof AppError)
    return { status: error.status, body: { error: error.message, code: error.code } };
  return {
    status: 500,
    body: { error: '云端连接失败，请检查函数配置和访问权限', code: 'INTERNAL_ERROR' },
  };
}
module.exports = { AppError, validate, responseError };
