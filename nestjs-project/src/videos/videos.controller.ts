import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CreateVideoUploadDto } from './dto/create-video-upload.dto';
import { CompleteVideoUploadDto } from './dto/complete-video-upload.dto';
import { RequestUploadPartsDto } from './dto/request-upload-parts.dto';
import {
  ChannelIdParamsDto,
  ChannelVideoIdParamsDto,
} from './dto/video-upload-params.dto';
import { VideoStatus } from './video-status.enum';
import { VideosService } from './videos.service';

type CreateVideoUploadResponse = {
  id: string;
  public_id: string;
  status: VideoStatus.DRAFT;
  part_size_bytes: number;
  upload_expires_at: string;
};

type UploadPartsResponse = {
  parts: Array<{
    part_number: number;
    url: string;
    expires_at: string;
  }>;
};

type CompleteVideoUploadResponse = {
  id: string;
  public_id: string;
  status: VideoStatus.DRAFT;
  processing_queued: true;
};

const API_ERROR_SCHEMA = { $ref: getSchemaPath(ApiErrorEnvelope) };

@ApiTags('videos')
@Controller('channels/:channelId/videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post('uploads')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Create a video upload draft',
    description:
      'Creates an owner-scoped draft and multipart upload session. The response exposes only product video identifiers and upload timing metadata.',
  })
  @ApiParam({
    name: 'channelId',
    format: 'uuid',
    description: 'UUID of the channel that owns the draft.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Video upload draft created',
    schema: {
      type: 'object',
      required: [
        'id',
        'public_id',
        'status',
        'part_size_bytes',
        'upload_expires_at',
      ],
      properties: {
        id: { type: 'string', format: 'uuid' },
        public_id: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: [VideoStatus.DRAFT] },
        part_size_bytes: { type: 'integer', example: 5_242_880 },
        upload_expires_at: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed (VALIDATION_ERROR)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid access token',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Caller does not own the channel (CHANNEL_ACCESS_DENIED)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Channel was not found (CHANNEL_NOT_FOUND)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    description: 'Declared size exceeds 10 GB (VIDEO_SIZE_LIMIT_EXCEEDED)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    description:
      'MIME type is outside the configured allowlist (UNSUPPORTED_VIDEO_MEDIA_TYPE)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Storage is temporarily unavailable (STORAGE_UNAVAILABLE)',
    schema: API_ERROR_SCHEMA,
  })
  async createUpload(
    @CurrentUser() user: JwtPayload,
    @Param() params: ChannelIdParamsDto,
    @Body() dto: CreateVideoUploadDto,
  ): Promise<CreateVideoUploadResponse> {
    const video = await this.videosService.startUpload(
      user.sub,
      params.channelId,
      {
        title: dto.title,
        originalFilename: dto.original_filename,
        contentType: dto.content_type,
        sizeBytes: dto.size_bytes,
      },
    );

    return {
      id: video.id,
      public_id: video.public_id,
      status: VideoStatus.DRAFT,
      part_size_bytes: this.videosService.getMultipartPartSizeBytes(),
      upload_expires_at: video.multipart_expires_at!.toISOString(),
    };
  }

  @Post(':videoId/upload-parts')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Sign multipart upload parts',
    description:
      'Returns an opaque, short-lived upload capability for each requested part of an owner-scoped draft.',
  })
  @ApiParam({
    name: 'channelId',
    format: 'uuid',
    description: 'UUID of the channel that owns the video.',
  })
  @ApiParam({
    name: 'videoId',
    format: 'uuid',
    description: 'UUID of the video draft.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Short-lived multipart upload capabilities',
    schema: {
      type: 'object',
      required: ['parts'],
      properties: {
        parts: {
          type: 'array',
          items: {
            type: 'object',
            required: ['part_number', 'url', 'expires_at'],
            properties: {
              part_number: { type: 'integer', minimum: 1 },
              url: {
                type: 'string',
                format: 'uri',
                description: 'Opaque, short-lived upload capability.',
              },
              expires_at: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed (VALIDATION_ERROR)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid access token',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Caller does not own the channel (CHANNEL_ACCESS_DENIED)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description:
      'Channel or video was not found (CHANNEL_NOT_FOUND or VIDEO_NOT_FOUND)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Video is no longer an active draft (VIDEO_UPLOAD_NOT_DRAFT)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.GONE,
    description: 'Multipart session expired (MULTIPART_UPLOAD_EXPIRED)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Storage is temporarily unavailable (STORAGE_UNAVAILABLE)',
    schema: API_ERROR_SCHEMA,
  })
  async requestUploadParts(
    @CurrentUser() user: JwtPayload,
    @Param() params: ChannelVideoIdParamsDto,
    @Body() dto: RequestUploadPartsDto,
  ): Promise<UploadPartsResponse> {
    const signed = await this.videosService.signUploadParts(
      user.sub,
      params.channelId,
      params.videoId,
      dto.part_numbers,
    );

    return {
      parts: signed.parts.map((part) => ({
        part_number: part.partNumber,
        url: part.url,
        expires_at: signed.expiresAt.toISOString(),
      })),
    };
  }

  @Post(':videoId/complete-upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete a multipart video upload',
    description:
      'Confirms owner-supplied multipart ETags, verifies the completed object, and persists one durable processing request.',
  })
  @ApiParam({
    name: 'channelId',
    format: 'uuid',
    description: 'UUID of the channel that owns the video.',
  })
  @ApiParam({
    name: 'videoId',
    format: 'uuid',
    description: 'UUID of the video draft.',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Upload completed and processing durably requested',
    schema: {
      type: 'object',
      required: ['id', 'public_id', 'status', 'processing_queued'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        public_id: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: [VideoStatus.DRAFT] },
        processing_queued: { type: 'boolean', enum: [true] },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed (VALIDATION_ERROR)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid access token',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Caller does not own the channel (CHANNEL_ACCESS_DENIED)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description:
      'Channel or video was not found (CHANNEL_NOT_FOUND or VIDEO_NOT_FOUND)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Video is no longer an active draft (VIDEO_UPLOAD_NOT_DRAFT)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.GONE,
    description: 'Multipart session expired (MULTIPART_UPLOAD_EXPIRED)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    description: 'Completed object exceeds 10 GB (VIDEO_SIZE_LIMIT_EXCEEDED)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    description: 'Multipart parts were rejected (MULTIPART_COMPLETION_INVALID)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Storage is temporarily unavailable (STORAGE_UNAVAILABLE)',
    schema: API_ERROR_SCHEMA,
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param() params: ChannelVideoIdParamsDto,
    @Body() dto: CompleteVideoUploadDto,
  ): Promise<CompleteVideoUploadResponse> {
    const video = await this.videosService.completeUpload(
      user.sub,
      params.channelId,
      params.videoId,
      dto.parts.map((part) => ({
        partNumber: part.part_number,
        etag: part.e_tag,
      })),
    );

    return {
      id: video.id,
      public_id: video.public_id,
      status: VideoStatus.DRAFT,
      processing_queued: true,
    };
  }

  @Delete(':videoId/upload')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Cancel a multipart video upload',
    description:
      'Aborts the active multipart session and removes only the owner-scoped draft.',
  })
  @ApiParam({
    name: 'channelId',
    format: 'uuid',
    description: 'UUID of the channel that owns the video.',
  })
  @ApiParam({
    name: 'videoId',
    format: 'uuid',
    description: 'UUID of the video draft.',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Upload draft cancelled',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid access token',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Caller does not own the channel (CHANNEL_ACCESS_DENIED)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description:
      'Channel or video was not found (CHANNEL_NOT_FOUND or VIDEO_NOT_FOUND)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Video is no longer an active draft (VIDEO_UPLOAD_NOT_DRAFT)',
    schema: API_ERROR_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Storage is temporarily unavailable (STORAGE_UNAVAILABLE)',
    schema: API_ERROR_SCHEMA,
  })
  async cancelUpload(
    @CurrentUser() user: JwtPayload,
    @Param() params: ChannelVideoIdParamsDto,
  ): Promise<void> {
    return this.videosService.cancelUpload(
      user.sub,
      params.channelId,
      params.videoId,
    );
  }
}
