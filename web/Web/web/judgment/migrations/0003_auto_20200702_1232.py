# Generated by Django 3.0.5 on 2020-07-02 16:32

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('judgment', '0002_auto_20200612_2039'),
    ]

    operations = [
        migrations.RenameField(
            model_name='judgment',
            old_name='timeVerbose',
            new_name='historyVerbose',
        ),
    ]
