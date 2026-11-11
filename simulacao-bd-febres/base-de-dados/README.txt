Backup generated at 20261014_171835
Folder: /home/simao/projects/vet-manager-scripts/backups/vetmanag_vm_febres_20261014_171835
Database: vetmanag_vm_febres
Server: 127.0.0.1:33310

Files:
  - vetmanag_vm_febres_20261014_171835.sql.zst
  - vetmanag_vm_febres_20261014_171835.sql.zst.sha256

Integrity check:
  - Open vetmanag_vm_febres_20261014_171835.sql.zst.sha256 and compare the SHA-256 hash.
  - Linux/macOS:  shasum -a 256 vetmanag_vm_febres_20261014_171835.sql.zst

Restore:
  1) Create the DB if not exists:
       mysql -h 127.0.0.1 -P 33310 -u root -p -e "CREATE DATABASE IF NOT EXISTS vetmanag_vm_febres /*!40100 DEFAULT CHARACTER SET utf8mb4 */;"
  2) Import:
       zstd -dc vetmanag_vm_febres_20261014_171835.sql.zst | mysql -h 127.0.0.1 -P 33310 -u root -p vetmanag_vm_febres

Notes:
  - Excluded tables: animal_exams_deleted, appointment_products_composed_deleted, appointment_products_deleted, appointments_recent, autografus, backoffice, hospitalization_products_composed_deleted, hospitalization_products_deleted, hospitalizations_recent, invoice_series, invoices_payment_services, invoices_recent, ip_addresses, log_history, migrations, payment_links, periodics_animals_deleted, permissions, popup_leti, sms_agenda_clinic_page_requests, sms_agenda_closed_days, sms_agenda_requests, sms_agenda_weekly_schedules, user_reason_link, users_login_history, visits_recent.
  - Views are not included (visits_waitingroom_waitroomtime_view, clients_not_erased_view, visits_missed_twodays_view, animals_not_erased_view).
  - Table subclinics is recreated with DDL and populated only with columns:
      subclinic_id, subclinic_name, subclinic_state, subclinic_address,
      subclinic_postal_code, subclinic_city, subclinic_cae, created_at, updated_at.
