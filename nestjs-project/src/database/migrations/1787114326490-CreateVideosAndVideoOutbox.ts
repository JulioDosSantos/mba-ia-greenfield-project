import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideosAndVideoOutbox1787114326490
  implements MigrationInterface
{
  name = 'CreateVideosAndVideoOutbox1787114326490';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('DRAFT', 'PROCESSING', 'READY', 'ERROR')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel_id" uuid NOT NULL, "public_id" uuid NOT NULL, "status" "public"."videos_status_enum" NOT NULL DEFAULT 'DRAFT', "title" character varying(255) NOT NULL, "original_filename" character varying(255) NOT NULL, "content_type" character varying(255) NOT NULL, "size_bytes" bigint NOT NULL, "storage_key" character varying(512) NOT NULL, "thumbnail_key" character varying(512), "multipart_upload_id" character varying(512), "multipart_expires_at" TIMESTAMP WITH TIME ZONE, "duration_seconds" integer, "metadata" jsonb, "processing_attempts" smallint NOT NULL DEFAULT 0, "error_code" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_videos_size_bytes" CHECK ("size_bytes" > 0 AND "size_bytes" <= 10000000000), CONSTRAINT "PK_videos_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_videos_public_id" ON "videos" ("public_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_id_status" ON "videos" ("channel_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_status_multipart_expires_at" ON "videos" ("status", "multipart_expires_at")`,
    );
    await queryRunner.query(
      `CREATE TABLE "video_outbox" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "video_id" uuid NOT NULL, "event_type" character varying(64) NOT NULL, "payload" jsonb NOT NULL, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "published_at" TIMESTAMP WITH TIME ZONE, "publish_attempts" smallint NOT NULL DEFAULT 0, "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_video_outbox_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_video_outbox_video_id_event_type" ON "video_outbox" ("video_id", "event_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_video_outbox_published_at_occurred_at" ON "video_outbox" ("published_at", "occurred_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_videos_channel_id" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_outbox" ADD CONSTRAINT "FK_video_outbox_video_id" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "video_outbox" DROP CONSTRAINT "FK_video_outbox_video_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_videos_channel_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_video_outbox_published_at_occurred_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_video_outbox_video_id_event_type"`,
    );
    await queryRunner.query(`DROP TABLE "video_outbox"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_videos_status_multipart_expires_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_videos_channel_id_status"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_public_id"`);
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}
