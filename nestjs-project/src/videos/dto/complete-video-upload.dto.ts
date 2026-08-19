import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CompleteVideoUploadPartDto {
  /** Multipart part number returned when the part was signed. */
  @IsInt()
  @Min(1)
  part_number: number;

  /** ETag returned by object storage after the direct part upload. */
  @IsString()
  @IsNotEmpty()
  e_tag: string;
}

export class CompleteVideoUploadDto {
  /** Strictly ascending multipart parts captured from successful direct uploads. */
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CompleteVideoUploadPartDto)
  parts: CompleteVideoUploadPartDto[];
}
