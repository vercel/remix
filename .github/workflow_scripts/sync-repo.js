const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async ({ github, context }) => {
    const { owner, repo } = context.repo;

    try {
        const packageJSONPath = path.join(
            __dirname,
            '..',
            '..',
            'packages',
            'remix-dev',
            'package.json'
        );

        let packageJSON = JSON.parse(fs.readFileSync(packageJSONPath, 'utf-8'));

        const existingVersion = packageJSON.version;
    
        await github.rest.repos.mergeUpstream({
            owner,
            repo,
            branch: 'main',
        });

        execSync('git pull origin main');

        packageJSON = JSON.parse(fs.readFileSync(packageJSONPath, 'utf-8'));

        const newVersion = packageJSON.version;

        if (existingVersion !== newVersion) {
            await github.rest.actions.createWorkflowDispatch({
                owner,
                repo,
                workflow_id: 'publish.yml',
                ref: 'main'
            });
        }

    } catch (err) {
        // Conflict detected
        if (err.code === 409) {
            const commit = await github.rest.repos.getCommit({
                owner: 'remix-run',
                repo: 'remix',
                ref: 'main'
            });
            console.log(commit);
            await github.rest.issues.create({
                owner,
                repo,
                title: 'Merge Conflict ❌',
                body: commit.data
            });
        }

        throw err
    }
};