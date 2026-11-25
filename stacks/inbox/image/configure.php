<?php

// Writes the settings the deploy owns into FreeScout's options table, which is where FreeScout reads
// them from: its system mail (sign-in invitations, notifications), sent through the relay with no
// login. A setting left unset in the environment keeps whatever an admin chose in the UI.

require '/app/vendor/autoload.php';
$app = require '/app/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$settings = [
    'company_name' => getenv('INBOX_COMPANY_NAME'),
    'mail_from' => getenv('INBOX_MAIL_FROM'),
    'mail_host' => getenv('INBOX_SMTP_HOST'),
    'mail_port' => getenv('INBOX_SMTP_PORT'),
    'mail_encryption' => getenv('INBOX_SMTP_ENCRYPTION'),
];
if (getenv('INBOX_SMTP_HOST')) {
    $settings['mail_driver'] = 'smtp';
    $settings['mail_username'] = '';
}

foreach ($settings as $name => $value) {
    if ($value !== false) {
        \App\Option::set($name, $value);
    }
}
