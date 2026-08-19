import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { VideoStatus } from '../video-status.enum';
import { VideoOutbox } from './video-outbox.entity';

@Entity('videos')
@Check(
  'CHK_videos_size_bytes',
  '"size_bytes" > 0 AND "size_bytes" <= 10000000000',
)
@Index('IDX_videos_public_id', ['public_id'], { unique: true })
@Index('IDX_videos_channel_id_status', ['channel_id', 'status'])
@Index('IDX_videos_status_multipart_expires_at', [
  'status',
  'multipart_expires_at',
])
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  channel_id: string;

  @Column({ type: 'uuid' })
  public_id: string;

  @Column({
    type: 'enum',
    enum: VideoStatus,
    default: VideoStatus.DRAFT,
  })
  status: VideoStatus;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 255 })
  original_filename: string;

  @Column({ type: 'varchar', length: 255 })
  content_type: string;

  @Column({ type: 'bigint' })
  size_bytes: string;

  @Column({ type: 'varchar', length: 512 })
  storage_key: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  multipart_upload_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  multipart_expires_at: Date | null;

  @Column({ type: 'integer', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'smallint', default: 0 })
  processing_attempts: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  error_code: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Channel, (channel) => channel.videos, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  @OneToMany(() => VideoOutbox, (videoOutbox) => videoOutbox.video)
  outbox_events: VideoOutbox[];
}
