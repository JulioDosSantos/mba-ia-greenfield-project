export abstract class DomainException extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class EmailAlreadyExistsException extends DomainException {
  constructor() {
    super('EMAIL_ALREADY_EXISTS', 409, 'Email is already registered');
  }
}

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
}

export class EmailNotConfirmedException extends DomainException {
  constructor() {
    super('EMAIL_NOT_CONFIRMED', 403, 'Email address has not been confirmed');
  }
}

export class InvalidTokenException extends DomainException {
  constructor() {
    super('INVALID_TOKEN', 401, 'Token is invalid');
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super('TOKEN_EXPIRED', 401, 'Token has expired');
  }
}

export class TokenReuseDetectedException extends DomainException {
  constructor() {
    super(
      'TOKEN_REUSE_DETECTED',
      401,
      'Token reuse detected — all sessions revoked',
    );
  }
}

export class ChannelNotFoundException extends DomainException {
  constructor() {
    super('CHANNEL_NOT_FOUND', 404, 'Channel was not found');
  }
}

export class ChannelAccessDeniedException extends DomainException {
  constructor() {
    super('CHANNEL_ACCESS_DENIED', 403, 'Channel access is denied');
  }
}

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video was not found');
  }
}

export class VideoSizeLimitExceededException extends DomainException {
  constructor() {
    super(
      'VIDEO_SIZE_LIMIT_EXCEEDED',
      413,
      'Video size exceeds the 10 GB limit',
    );
  }
}

export class VideoUploadNotDraftException extends DomainException {
  constructor() {
    super(
      'VIDEO_UPLOAD_NOT_DRAFT',
      409,
      'Video upload is no longer accepting multipart operations',
    );
  }
}

export class MultipartUploadExpiredException extends DomainException {
  constructor() {
    super(
      'MULTIPART_UPLOAD_EXPIRED',
      410,
      'Multipart upload session has expired',
    );
  }
}

export class MultipartCompletionInvalidException extends DomainException {
  constructor() {
    super(
      'MULTIPART_COMPLETION_INVALID',
      422,
      'Multipart upload completion is invalid',
    );
  }
}

export class VideoUploadValidationException extends DomainException {
  constructor() {
    super('VALIDATION_ERROR', 400, 'Video upload input is invalid');
  }
}

export class StorageUnavailableException extends DomainException {
  constructor() {
    super('STORAGE_UNAVAILABLE', 503, 'Storage is temporarily unavailable');
  }
}
