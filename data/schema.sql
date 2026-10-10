-- ========================================================
-- FitBot AI — MySQL Database Schema
-- Dapat diimpor melalui phpMyAdmin / HeidiSQL di Laragon
-- ========================================================

CREATE DATABASE IF NOT EXISTS `fitbot_db` 
  DEFAULT CHARACTER SET utf8mb4 
  COLLATE utf8mb4_unicode_ci;

USE `fitbot_db`;

-- 1. Tabel Leads (Pencatatan Calon Anggota Gym)
CREATE TABLE IF NOT EXISTS `leads` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `session_id` VARCHAR(191) UNIQUE NOT NULL COMMENT 'ID sesi Web / JID WhatsApp / ID Telegram',
  `channel` VARCHAR(50) NOT NULL DEFAULT 'web' COMMENT 'web | telegram | whatsapp',
  `name` VARCHAR(255) NULL COMMENT 'Nama pengguna atau nama profil',
  `phone_or_handle` VARCHAR(255) NULL COMMENT 'Nomor telepon / username',
  `interest` TEXT NULL COMMENT 'Topik ketertarikan (Membership, Trial, PT, Cabang)',
  `status` VARCHAR(50) DEFAULT 'NEW' COMMENT 'NEW | CONTACTED | FOLLOW_UP | CONVERTED',
  `message_count` INT DEFAULT 1 COMMENT 'Jumlah total interaksi chat',
  `first_contact` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `last_contact` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_leads_channel` (`channel`),
  INDEX `idx_leads_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Tabel Conversations (Riwayat Seluruh Chat Masuk & Keluar)
CREATE TABLE IF NOT EXISTS `conversations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `session_id` VARCHAR(191) NOT NULL,
  `channel` VARCHAR(50) NOT NULL DEFAULT 'web',
  `sender` VARCHAR(50) NOT NULL COMMENT 'user | fifi',
  `message` TEXT NOT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_conversations_session` (`session_id`),
  INDEX `idx_conversations_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Tabel Gym Info (Profil & Kontak Resmi FitLife Arena)
CREATE TABLE IF NOT EXISTS `gym_info` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(150),
  `tagline` VARCHAR(255),
  `phone` VARCHAR(50),
  `email` VARCHAR(100),
  `instagram` VARCHAR(100),
  `customer_service_hours` VARCHAR(150),
  `note` TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Tabel Gym Branches (Daftar Cabang FitLife Arena)
CREATE TABLE IF NOT EXISTS `gym_branches` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `branch_id` VARCHAR(50) UNIQUE,
  `name` VARCHAR(150) NOT NULL,
  `address` TEXT NOT NULL,
  `phone` VARCHAR(50),
  `facilities_highlight` TEXT COMMENT 'JSON Array string'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Tabel Gym Operating Hours (Jam Operasional)
CREATE TABLE IF NOT EXISTS `gym_operating_hours` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `weekdays` TEXT,
  `weekends` TEXT,
  `holidays` TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Tabel Gym Facilities (Fasilitas & Kategori Alat)
CREATE TABLE IF NOT EXISTS `gym_facilities` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `category` VARCHAR(100) NOT NULL,
  `items` TEXT NOT NULL COMMENT 'JSON Array string'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Tabel Gym Memberships (Paket Keanggotaan)
CREATE TABLE IF NOT EXISTS `gym_memberships` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(150) NOT NULL,
  `description` TEXT,
  `benefits` TEXT COMMENT 'JSON Array string',
  `pricing_note` TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Tabel Gym FAQs (Basis Pengetahuan Tanya Jawab Dinamis Fifi)
CREATE TABLE IF NOT EXISTS `gym_faqs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `category` VARCHAR(100) DEFAULT 'Umum',
  `question` TEXT NOT NULL,
  `answer` TEXT NOT NULL,
  `is_active` TINYINT DEFAULT 1,
  INDEX `idx_faqs_category` (`category`),
  INDEX `idx_faqs_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
