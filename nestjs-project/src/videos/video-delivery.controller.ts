import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { VideoPublicIdParamsDto } from './dto/video-delivery-params.dto';
import type { VideoDelivery } from './video-delivery.service';
import { VideoDeliveryService } from './video-delivery.service';

const API_ERROR_SCHEMA = { $ref: getSchemaPath(ApiErrorEnvelope) };
const API_ERROR_CONTENT = {
  'application/json': { schema: API_ERROR_SCHEMA },
};
const VIDEO_MEDIA_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const;
const VIDEO_BINARY_CONTENT = {
  'application/octet-stream': {
    schema: { type: 'string', format: 'binary' },
  },
};

@ApiTags('videos')
@Controller('videos')
export class VideoDeliveryController {
  constructor(private readonly videoDeliveryService: VideoDeliveryService) {}

  @Get(':publicId/stream')
  @ApiBearerAuth('access-token')
  @ApiProduces(...VIDEO_MEDIA_TYPES)
  @ApiOperation({
    summary: 'Stream a ready private video',
    description:
      'Streams the owner-scoped ready object and forwards an optional HTTP byte range without buffering storage content in the API.',
  })
  @ApiParam({
    name: 'publicId',
    format: 'uuid',
    description: 'Public UUID of the ready video.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Entire ready video stream',
    content: VIDEO_BINARY_CONTENT,
    headers: {
      'Accept-Ranges': { schema: { type: 'string', example: 'bytes' } },
      'Content-Length': { schema: { type: 'integer', example: 1_024 } },
      'Content-Type': { schema: { type: 'string', example: 'video/mp4' } },
    },
  })
  @ApiResponse({
    status: HttpStatus.PARTIAL_CONTENT,
    description: 'Requested byte range from a ready video stream',
    content: VIDEO_BINARY_CONTENT,
    headers: {
      'Accept-Ranges': { schema: { type: 'string', example: 'bytes' } },
      'Content-Length': { schema: { type: 'integer', example: 100 } },
      'Content-Range': {
        schema: { type: 'string', example: 'bytes 0-99/1024' },
      },
      'Content-Type': { schema: { type: 'string', example: 'video/mp4' } },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed (VALIDATION_ERROR)',
    content: API_ERROR_CONTENT,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid access token',
    content: API_ERROR_CONTENT,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Caller does not own the video channel (VIDEO_ACCESS_DENIED)',
    content: API_ERROR_CONTENT,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Video was not found (VIDEO_NOT_FOUND)',
    content: API_ERROR_CONTENT,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Video is not ready for delivery (VIDEO_NOT_READY)',
    content: API_ERROR_CONTENT,
  })
  @ApiResponse({
    status: HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
    description:
      'Range is malformed or outside the object (RANGE_NOT_SATISFIABLE)',
    content: API_ERROR_CONTENT,
  })
  async stream(
    @CurrentUser() user: JwtPayload,
    @Param() params: VideoPublicIdParamsDto,
    @Headers('range') rangeHeader: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    this.writeDelivery(
      response,
      await this.videoDeliveryService.stream(
        user.sub,
        params.publicId,
        rangeHeader,
      ),
    );
  }

  @Get(':publicId/download')
  @ApiBearerAuth('access-token')
  @ApiProduces(...VIDEO_MEDIA_TYPES)
  @ApiOperation({
    summary: 'Download a ready private video',
    description:
      'Streams the owner-scoped ready object as a safe attachment without exposing storage location or credentials.',
  })
  @ApiParam({
    name: 'publicId',
    format: 'uuid',
    description: 'Public UUID of the ready video.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Ready video attachment',
    content: VIDEO_BINARY_CONTENT,
    headers: {
      'Accept-Ranges': { schema: { type: 'string', example: 'bytes' } },
      'Content-Disposition': {
        schema: {
          type: 'string',
          example:
            'attachment; filename="video.mp4"; filename*=UTF-8\'\'video.mp4',
        },
      },
      'Content-Length': { schema: { type: 'integer', example: 1_024 } },
      'Content-Type': { schema: { type: 'string', example: 'video/mp4' } },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed (VALIDATION_ERROR)',
    content: API_ERROR_CONTENT,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid access token',
    content: API_ERROR_CONTENT,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Caller does not own the video channel (VIDEO_ACCESS_DENIED)',
    content: API_ERROR_CONTENT,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Video was not found (VIDEO_NOT_FOUND)',
    content: API_ERROR_CONTENT,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Video is not ready for delivery (VIDEO_NOT_READY)',
    content: API_ERROR_CONTENT,
  })
  async download(
    @CurrentUser() user: JwtPayload,
    @Param() params: VideoPublicIdParamsDto,
    @Res() response: Response,
  ): Promise<void> {
    this.writeDelivery(
      response,
      await this.videoDeliveryService.download(user.sub, params.publicId),
    );
  }

  private writeDelivery(response: Response, delivery: VideoDelivery): void {
    response.status(delivery.statusCode).set(delivery.headers);
    delivery.stream.pipe(response);
  }
}
