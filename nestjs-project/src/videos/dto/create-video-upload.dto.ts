import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class CreateVideoUploadDto {
  /** Original client filename, retained only as video metadata. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  original_filename: string;

  /** Initial title for the video draft. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  /** Video MIME type, checked against the server-configured allowlist. */
  @IsString()
  @IsNotEmpty()
  content_type: string;

  /** Declared video size in bytes. Values above 10 GB are rejected by the lifecycle service. */
  @IsInt()
  @Min(1)
  size_bytes: number;
}
