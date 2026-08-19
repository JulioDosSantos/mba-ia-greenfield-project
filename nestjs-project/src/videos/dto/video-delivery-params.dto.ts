import { IsUUID } from 'class-validator';

export class VideoPublicIdParamsDto {
  /** Public UUID of the ready video. */
  @IsUUID()
  publicId: string;
}
