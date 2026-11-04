-- Dijalankan hanya saat volume database baru diinisialisasi pertama kali.
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'glink_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON globallink_approval.* TO 'glink_app'@'%';
