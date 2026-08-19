import { IsUUID } from 'class-validator';

export class ChannelIdParamsDto {
  /** UUID of the channel that owns the video. */
  @IsUUID()
  channelId: string;
}

export class ChannelVideoIdParamsDto extends ChannelIdParamsDto {
  /** UUID of the video draft. */
  @IsUUID()
  videoId: string;
}
