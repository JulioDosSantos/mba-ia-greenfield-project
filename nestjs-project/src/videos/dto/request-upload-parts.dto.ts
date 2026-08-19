import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';

export class RequestUploadPartsDto {
  /** Distinct positive multipart part numbers to sign. */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  part_numbers: number[];
}
