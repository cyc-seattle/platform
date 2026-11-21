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

// Dev only: a mailbox that reads GreenMail, and a volunteer on it, for the integration tests. Prod's
// mailboxes are set up by hand, since each signs in to Google as its own user.
$testMailbox = getenv('INBOX_TEST_MAILBOX');
if ($testMailbox) {
    $mailbox = \App\Mailbox::where('email', $testMailbox)->first() ?? new \App\Mailbox();
    $mailbox->fill(['email' => $testMailbox, 'name' => 'Test inbox']);
    $mailbox->in_protocol = \App\Mailbox::IN_PROTOCOL_IMAP;
    $mailbox->in_server = getenv('INBOX_SMTP_HOST');
    $mailbox->in_port = 3143;
    $mailbox->in_username = $testMailbox;
    // GreenMail takes any password.
    $mailbox->in_password = 'greenmail';
    $mailbox->in_encryption = \App\Mailbox::IN_ENCRYPTION_NONE;
    $mailbox->out_method = \App\Mailbox::OUT_METHOD_SMTP;
    $mailbox->out_server = getenv('INBOX_SMTP_HOST');
    $mailbox->out_port = (int) getenv('INBOX_SMTP_PORT');
    $mailbox->out_encryption = \App\Mailbox::OUT_ENCRYPTION_NONE;
    $mailbox->save();

    $email = getenv('INBOX_TEST_VOLUNTEER');
    $volunteer = \App\User::where('email', $email)->first();
    if (!$volunteer) {
        $volunteer = new \App\User();
        $volunteer->first_name = 'Test';
        $volunteer->last_name = 'Volunteer';
        $volunteer->email = $email;
        $volunteer->role = \App\User::ROLE_USER;
        $volunteer->invite_state = \App\User::INVITE_STATE_ACTIVATED;
        $volunteer->password = \Hash::make(\Str::random(32));
        $volunteer->save();
    }
    $mailbox->users()->syncWithoutDetaching([$volunteer->id]);
    $mailbox->syncPersonalFolders();
}
